import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderStatusLogsTable,
  riderAssignmentsTable,
  ridersTable,
  restaurantsTable,
  tripsTable,
  tripStopsTable,
  usersTable,
  type Trip,
  type TripStop,
  type TripStatus,
  type TripStopKind,
  type Order,
} from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth";
import { httpError } from "../lib/errors";
import {
  serializeOrderListItems,
  type SerializedOrderListItem,
} from "../lib/order-serialize";
import {
  sendPushToRider,
  sendPushToRoles,
  sendPushToRestaurantStaff,
} from "../lib/push";
import {
  audienceForTripAssigned,
  audienceForTripDissolved,
} from "../lib/push-triggers";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

// =====================================================================
// Helpers
// =====================================================================

type TripView = ReturnType<typeof tripListItemFromRow>;

function tripListItemFromRow(args: {
  trip: Trip;
  riderName: string | null;
  orderCount: number;
  stopCount: number;
  completedStopCount: number;
}) {
  return {
    id: args.trip.id,
    tripNumber: args.trip.tripNumber,
    name: args.trip.name,
    riderId: args.trip.riderId,
    riderName: args.riderName,
    status: args.trip.status,
    orderCount: args.orderCount,
    stopCount: args.stopCount,
    completedStopCount: args.completedStopCount,
    createdAt: args.trip.createdAt,
    updatedAt: args.trip.updatedAt,
  };
}

async function loadTripView(tripId: string): Promise<TripView | null> {
  const [trip] = await db
    .select()
    .from(tripsTable)
    .where(eq(tripsTable.id, tripId));
  if (!trip) return null;
  const stops = await db
    .select()
    .from(tripStopsTable)
    .where(eq(tripStopsTable.tripId, tripId));
  const orderCount = new Set(stops.map((s) => s.orderId)).size;
  const completedStopCount = stops.filter((s) => s.completedAt != null).length;
  let riderName: string | null = null;
  if (trip.riderId) {
    const [r] = await db
      .select({ name: usersTable.name })
      .from(ridersTable)
      .innerJoin(usersTable, eq(usersTable.id, ridersTable.userId))
      .where(eq(ridersTable.id, trip.riderId));
    riderName = r?.name ?? null;
  }
  return tripListItemFromRow({
    trip,
    riderName,
    orderCount,
    stopCount: stops.length,
    completedStopCount,
  });
}

async function loadTripDetail(tripId: string) {
  const [trip] = await db
    .select()
    .from(tripsTable)
    .where(eq(tripsTable.id, tripId));
  if (!trip) return null;

  const stops = await db
    .select()
    .from(tripStopsTable)
    .where(eq(tripStopsTable.tripId, tripId))
    .orderBy(asc(tripStopsTable.sequence));

  const orderIds = Array.from(new Set(stops.map((s) => s.orderId)));
  const orders =
    orderIds.length > 0
      ? await db
          .select()
          .from(ordersTable)
          .where(inArray(ordersTable.id, orderIds))
      : ([] as Order[]);
  const serializedOrders = await serializeOrderListItems(orders);
  const orderById = new Map<string, SerializedOrderListItem>(
    serializedOrders.map((o) => [o.id, o]),
  );

  const restaurantIds = Array.from(
    new Set(orders.map((o) => o.restaurantId)),
  );
  const restRows = restaurantIds.length
    ? await db
        .select({ id: restaurantsTable.id, name: restaurantsTable.name })
        .from(restaurantsTable)
        .where(inArray(restaurantsTable.id, restaurantIds))
    : [];
  const restName = new Map(restRows.map((r) => [r.id, r.name]));

  let riderName: string | null = null;
  if (trip.riderId) {
    const [r] = await db
      .select({ name: usersTable.name })
      .from(ridersTable)
      .innerJoin(usersTable, eq(usersTable.id, ridersTable.userId))
      .where(eq(ridersTable.id, trip.riderId));
    riderName = r?.name ?? null;
  }

  const stopsWithOrder = stops.map((s) => {
    const o = orderById.get(s.orderId);
    return {
      id: s.id,
      orderId: s.orderId,
      kind: s.kind,
      sequence: s.sequence,
      completedAt: s.completedAt,
      externalOrderId: o?.externalOrderId ?? "",
      customerName: o?.customerName ?? "",
      restaurantId: o?.restaurantId ?? "",
      restaurantName: restName.get(o?.restaurantId ?? "") ?? "",
      deliveryAddress: o?.deliveryAddress ?? "",
      orderStatus: o?.status ?? "pending",
      effectivePickupTime: o?.effectivePickupTime ?? new Date(0),
    };
  });

  const completedStopCount = stops.filter((s) => s.completedAt != null).length;
  const list = tripListItemFromRow({
    trip,
    riderName,
    orderCount: orderIds.length,
    stopCount: stops.length,
    completedStopCount,
  });

  return {
    ...list,
    stops: stopsWithOrder,
    orders: serializedOrders,
  };
}

/**
 * Build the default stop sequence for a new trip: all pickups first (in
 * ascending effective-pickup-time order, ties broken by orderIds order),
 * then all dropoffs in the same order as orderIds.
 */
function buildDefaultStops(orders: Order[], orderIds: string[]): {
  orderId: string;
  kind: TripStopKind;
  sequence: number;
}[] {
  const indexById = new Map(orderIds.map((id, i) => [id, i]));
  const sortedForPickup = [...orders].sort((a, b) => {
    const aTime = effective(a).getTime();
    const bTime = effective(b).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
  });
  const stops: { orderId: string; kind: TripStopKind; sequence: number }[] = [];
  let seq = 0;
  for (const o of sortedForPickup) {
    stops.push({ orderId: o.id, kind: "pickup", sequence: seq++ });
  }
  // Dropoffs in orderIds order — coordinator can reorder later.
  for (const id of orderIds) {
    if (orders.find((o) => o.id === id)) {
      stops.push({ orderId: id, kind: "dropoff", sequence: seq++ });
    }
  }
  return stops;
}

function effective(o: Order): Date {
  return (
    o.pickupTimeOverride ??
    o.pickupTimeRestaurant ??
    o.pickupTimeRider ??
    o.pickupTimeOriginal
  );
}

// =====================================================================
// GET /trips
// =====================================================================
router.get(
  "/trips",
  requireAuth,
  wrap(async (req, res) => {
    const auth = req.auth!;
    const status = typeof req.query["status"] === "string" ? (req.query["status"] as TripStatus) : null;
    const riderId = typeof req.query["riderId"] === "string" ? req.query["riderId"] : null;

    const filters = [] as ReturnType<typeof eq>[];
    if (status) filters.push(eq(tripsTable.status, status));
    if (riderId) filters.push(eq(tripsTable.riderId, riderId));

    // Restaurant staff have no read access to trips.
    if (auth.role === "restaurant_staff") {
      res.json([]);
      return;
    }
    // Riders see only their own trips.
    if (auth.role === "rider") {
      if (!auth.riderId) {
        res.json([]);
        return;
      }
      filters.push(eq(tripsTable.riderId, auth.riderId));
    }

    const where = filters.length ? and(...filters) : undefined;
    const rows = await db
      .select()
      .from(tripsTable)
      .where(where)
      .orderBy(desc(tripsTable.createdAt))
      .limit(200);

    if (rows.length === 0) {
      res.json([]);
      return;
    }

    const tripIds = rows.map((r) => r.id);
    const stops = await db
      .select()
      .from(tripStopsTable)
      .where(inArray(tripStopsTable.tripId, tripIds));
    const riderIds = Array.from(
      new Set(rows.map((r) => r.riderId).filter((x): x is string => !!x)),
    );
    const riderRows = riderIds.length
      ? await db
          .select({ id: ridersTable.id, name: usersTable.name })
          .from(ridersTable)
          .innerJoin(usersTable, eq(usersTable.id, ridersTable.userId))
          .where(inArray(ridersTable.id, riderIds))
      : [];
    const riderNameById = new Map(riderRows.map((r) => [r.id, r.name]));

    const views = rows.map((trip) => {
      const tripStops = stops.filter((s) => s.tripId === trip.id);
      const orderCount = new Set(tripStops.map((s) => s.orderId)).size;
      const completed = tripStops.filter((s) => s.completedAt != null).length;
      return tripListItemFromRow({
        trip,
        riderName: trip.riderId ? (riderNameById.get(trip.riderId) ?? null) : null,
        orderCount,
        stopCount: tripStops.length,
        completedStopCount: completed,
      });
    });
    res.json(views);
  }),
);

// =====================================================================
// GET /trips/:id
// =====================================================================
router.get(
  "/trips/:id",
  requireAuth,
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const detail = await loadTripDetail(id);
    if (!detail) throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");

    // Authorization: riders can only read their own trips. Restaurant_staff
    // are blocked. Admin/coordinator unrestricted.
    if (auth.role === "restaurant_staff") {
      throw httpError(403, "FORBIDDEN", "Forbidden");
    }
    if (auth.role === "rider") {
      if (!auth.riderId || detail.riderId !== auth.riderId) {
        throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
      }
    }
    res.json(detail);
  }),
);

// =====================================================================
// POST /trips — create
// =====================================================================
router.post(
  "/trips",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const auth = req.auth!;
    const body = req.body as {
      name?: string | null;
      riderId?: string | null;
      orderIds?: string[];
    };
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds : [];
    if (orderIds.length === 0) {
      throw httpError(400, "VALIDATION_ERROR", "orderIds required");
    }
    const uniqueOrderIds = Array.from(new Set(orderIds));
    if (uniqueOrderIds.length !== orderIds.length) {
      throw httpError(400, "VALIDATION_ERROR", "Duplicate orderIds");
    }

    const orders = await db
      .select()
      .from(ordersTable)
      .where(inArray(ordersTable.id, uniqueOrderIds));
    if (orders.length !== uniqueOrderIds.length) {
      throw httpError(404, "ORDER_NOT_FOUND", "One or more orders missing");
    }
    for (const o of orders) {
      if (o.tripId) {
        throw httpError(
          409,
          "ORDER_ON_TRIP",
          `Order ${o.externalOrderId} is already on a trip`,
        );
      }
      if (
        o.status !== "pending" &&
        o.status !== "driver_assigned"
      ) {
        throw httpError(
          422,
          "ORDER_NOT_BUNDLEABLE",
          `Order ${o.externalOrderId} is not bundleable in status ${o.status}`,
        );
      }
    }

    const riderId = body.riderId ?? null;
    if (riderId) {
      const [rider] = await db
        .select({ id: ridersTable.id })
        .from(ridersTable)
        .where(eq(ridersTable.id, riderId));
      if (!rider) throw httpError(404, "RIDER_NOT_FOUND", "Rider not found");
    }

    const [trip] = await db
      .insert(tripsTable)
      .values({
        name: body.name ?? null,
        riderId,
        status: "planned",
        createdByUserId: auth.sub,
      })
      .returning();
    if (!trip) throw httpError(500, "DB_ERROR", "Failed to create trip");

    const stops = buildDefaultStops(orders, uniqueOrderIds);
    await db.insert(tripStopsTable).values(
      stops.map((s) => ({
        tripId: trip.id,
        orderId: s.orderId,
        kind: s.kind,
        sequence: s.sequence,
      })),
    );

    // Attach orders. If riderId provided, also assign them (pending → driver_assigned).
    const orderUpdates: Promise<unknown>[] = [];
    for (const o of orders) {
      if (riderId && o.status === "pending") {
        orderUpdates.push(
          (async () => {
            const upd = await db
              .update(ordersTable)
              .set({ tripId: trip.id, riderId, status: "driver_assigned" })
              .where(
                and(
                  eq(ordersTable.id, o.id),
                  eq(ordersTable.status, "pending"),
                ),
              )
              .returning();
            if (upd.length === 0) {
              throw httpError(
                409,
                "STATE_CONFLICT",
                `Order ${o.externalOrderId} state changed concurrently`,
              );
            }
            await db.insert(orderStatusLogsTable).values({
              orderId: o.id,
              fromStatus: "pending",
              toStatus: "driver_assigned",
              actorUserId: auth.sub,
              actorRole: auth.role,
              note: `Bundled into trip #${trip.tripNumber}`,
            });
            await db.insert(riderAssignmentsTable).values({
              orderId: o.id,
              riderId,
              outcome: "assigned",
              assignedByUserId: auth.sub,
            });
          })(),
        );
      } else {
        orderUpdates.push(
          db
            .update(ordersTable)
            .set({ tripId: trip.id, ...(riderId ? { riderId } : {}) })
            .where(eq(ordersTable.id, o.id))
            .then(() => undefined),
        );
      }
    }
    await Promise.all(orderUpdates);

    // Push: notify the rider (if assigned) and coordinators.
    if (riderId) {
      const audience = audienceForTripAssigned();
      await Promise.all([
        sendPushToRider(riderId, {
          title: `Nieuwe rit toegewezen — Trip #${trip.tripNumber}`,
          body: `${orders.length} orders`,
          data: { tripId: trip.id, type: "trip.assigned" },
        }),
        sendPushToRoles(audience.roles, {
          title: `Trip #${trip.tripNumber} aangemaakt`,
          body: `${orders.length} orders`,
          data: { tripId: trip.id, type: "trip.created" },
        }),
      ]);
    }
    const detail = await loadTripDetail(trip.id);
    res.status(201).json(detail);
  }),
);

// =====================================================================
// PATCH /trips/:id — rename / reassign
// =====================================================================
router.patch(
  "/trips/:id",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const body = req.body as { name?: string | null; riderId?: string | null };

    const [trip] = await db
      .select()
      .from(tripsTable)
      .where(eq(tripsTable.id, id));
    if (!trip) throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
    if (trip.status === "dissolved" || trip.status === "completed") {
      throw httpError(422, "TRIP_TERMINAL", "Trip is no longer editable");
    }

    const updates: Partial<typeof tripsTable.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name ?? null;
    if (body.riderId !== undefined) {
      const newRiderId = body.riderId ?? null;
      if (newRiderId) {
        const [rider] = await db
          .select({ id: ridersTable.id })
          .from(ridersTable)
          .where(eq(ridersTable.id, newRiderId));
        if (!rider) throw httpError(404, "RIDER_NOT_FOUND", "Rider not found");
      }
      updates.riderId = newRiderId;
    }
    if (Object.keys(updates).length > 0) {
      await db.update(tripsTable).set(updates).where(eq(tripsTable.id, id));
    }

    // If rider changed, propagate to non-terminal orders on the trip.
    if (body.riderId !== undefined) {
      const newRiderId = body.riderId ?? null;
      const tripOrders = await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.tripId, id));
      for (const o of tripOrders) {
        // Do not yank a rider mid-flight or rewind any in-flight leg.
        // Reassignment only affects orders that have not yet started moving.
        if (
          o.status !== "pending" &&
          o.status !== "driver_assigned"
        ) {
          continue;
        }
        if (newRiderId == null) {
          await db
            .update(ordersTable)
            .set({ riderId: null, status: "pending" })
            .where(eq(ordersTable.id, o.id));
          await db.insert(orderStatusLogsTable).values({
            orderId: o.id,
            fromStatus: o.status,
            toStatus: "pending",
            actorUserId: auth.sub,
            actorRole: auth.role,
            note: `Trip #${trip.tripNumber} unassigned`,
          });
          await db.insert(riderAssignmentsTable).values({
            orderId: o.id,
            riderId: o.riderId,
            outcome: "unassigned",
            assignedByUserId: auth.sub,
          });
        } else if (o.riderId !== newRiderId) {
          await db
            .update(ordersTable)
            .set({ riderId: newRiderId, status: "driver_assigned" })
            .where(eq(ordersTable.id, o.id));
          if (o.status !== "driver_assigned") {
            await db.insert(orderStatusLogsTable).values({
              orderId: o.id,
              fromStatus: o.status,
              toStatus: "driver_assigned",
              actorUserId: auth.sub,
              actorRole: auth.role,
              note: `Trip #${trip.tripNumber} reassigned`,
            });
          }
          await db.insert(riderAssignmentsTable).values({
            orderId: o.id,
            riderId: newRiderId,
            outcome: o.riderId ? "reassigned" : "assigned",
            assignedByUserId: auth.sub,
          });
        }
      }
      if (newRiderId) {
        await sendPushToRider(newRiderId, {
          title: `Trip #${trip.tripNumber} toegewezen`,
          body: trip.name ?? `${tripOrders.length} orders`,
          data: { tripId: trip.id, type: "trip.assigned" },
        });
      }
    }

    const detail = await loadTripDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// PUT /trips/:id/stops — replace stop list
// =====================================================================
router.put(
  "/trips/:id/stops",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const body = req.body as {
      stops?: { orderId: string; kind: TripStopKind }[];
    };
    const inputStops = Array.isArray(body.stops) ? body.stops : [];
    if (inputStops.length === 0) {
      throw httpError(400, "VALIDATION_ERROR", "stops required");
    }

    const [trip] = await db
      .select()
      .from(tripsTable)
      .where(eq(tripsTable.id, id));
    if (!trip) throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
    if (trip.status === "dissolved" || trip.status === "completed") {
      throw httpError(422, "TRIP_TERMINAL", "Trip is no longer editable");
    }

    const tripOrders = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.tripId, id));
    const allowedOrderIds = new Set(tripOrders.map((o) => o.id));
    for (const s of inputStops) {
      if (!allowedOrderIds.has(s.orderId)) {
        throw httpError(
          400,
          "STOP_ORDER_MISMATCH",
          `Order ${s.orderId} is not on this trip`,
        );
      }
      if (s.kind !== "pickup" && s.kind !== "dropoff") {
        throw httpError(400, "VALIDATION_ERROR", "Invalid stop kind");
      }
    }

    // Capture previous completedAt by (orderId, kind) so we don't lose
    // progress on reorder.
    const existing = await db
      .select()
      .from(tripStopsTable)
      .where(eq(tripStopsTable.tripId, id));
    const completedKey = (s: TripStop) => `${s.orderId}:${s.kind}`;
    const prevCompleted = new Map<string, Date>();
    for (const s of existing) {
      if (s.completedAt) prevCompleted.set(completedKey(s), s.completedAt);
    }

    await db.delete(tripStopsTable).where(eq(tripStopsTable.tripId, id));
    await db.insert(tripStopsTable).values(
      inputStops.map((s, i) => ({
        tripId: id,
        orderId: s.orderId,
        kind: s.kind,
        sequence: i,
        completedAt: prevCompleted.get(`${s.orderId}:${s.kind}`) ?? null,
      })),
    );

    const detail = await loadTripDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /trips/:id/dissolve — dissolve trip
// =====================================================================
router.post(
  "/trips/:id/dissolve",
  requireAuth,
  requireRole("admin", "coordinator", "rider"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;

    const [trip] = await db
      .select()
      .from(tripsTable)
      .where(eq(tripsTable.id, id));
    if (!trip) throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
    if (trip.status === "dissolved" || trip.status === "completed") {
      throw httpError(422, "TRIP_TERMINAL", "Trip already terminal");
    }
    // Riders may only dissolve their own trip.
    if (auth.role === "rider") {
      if (!auth.riderId || trip.riderId !== auth.riderId) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }
    }

    const tripOrders = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.tripId, id));

    for (const o of tripOrders) {
      // Pre-flight orders revert to pending; in-flight keep status/rider but
      // detach from the trip.
      if (o.status === "pending" || o.status === "driver_assigned") {
        await db
          .update(ordersTable)
          .set({ tripId: null, riderId: null, status: "pending" })
          .where(eq(ordersTable.id, o.id));
        if (o.status !== "pending") {
          await db.insert(orderStatusLogsTable).values({
            orderId: o.id,
            fromStatus: o.status,
            toStatus: "pending",
            actorUserId: auth.sub,
            actorRole: auth.role,
            note: `Trip #${trip.tripNumber} dissolved`,
          });
        }
        if (o.riderId) {
          await db.insert(riderAssignmentsTable).values({
            orderId: o.id,
            riderId: o.riderId,
            outcome: "unassigned",
            assignedByUserId: auth.sub,
          });
        }
      } else {
        await db
          .update(ordersTable)
          .set({ tripId: null })
          .where(eq(ordersTable.id, o.id));
      }
    }

    await db
      .update(tripsTable)
      .set({ status: "dissolved" })
      .where(eq(tripsTable.id, id));

    const audience = audienceForTripDissolved();
    await Promise.all([
      sendPushToRoles(audience.roles, {
        title: `Trip #${trip.tripNumber} ontbonden`,
        body: trip.name ?? `${tripOrders.length} orders`,
        data: { tripId: trip.id, type: "trip.dissolved" },
      }),
      audience.notifyAssignedRider && trip.riderId
        ? sendPushToRider(trip.riderId, {
            title: `Trip #${trip.tripNumber} ontbonden`,
            body: trip.name ?? `${tripOrders.length} orders`,
            data: { tripId: trip.id, type: "trip.dissolved" },
          })
        : Promise.resolve(),
      ...(audience.notifyOrderRestaurantStaff
        ? Array.from(new Set(tripOrders.map((o) => o.restaurantId))).map(
            (restaurantId) =>
              sendPushToRestaurantStaff(restaurantId, {
                title: `Trip #${trip.tripNumber} ontbonden`,
                body: trip.name ?? `${tripOrders.length} orders`,
                data: { tripId: trip.id, type: "trip.dissolved" },
              }),
          )
        : []),
    ]);

    const detail = await loadTripDetail(id);
    res.json(detail);
  }),
);

export default router;
