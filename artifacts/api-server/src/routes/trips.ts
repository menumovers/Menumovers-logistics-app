import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  type TripStatus,
  type TripStopKind,
  type Order,
  type OrderStatus,
} from "@workspace/db";
import { requireAuth, requireRole, primaryRoleLabel } from "../lib/auth";
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
import { stopStateFor, tripProgress } from "../lib/trip-progress";
import { completeTripIfDone } from "../lib/trip-completion";

const router: IRouter = Router();

// An order in one of these hasn't left for the restaurant yet, so trip
// membership and rider can still be freely changed. Anything past this is
// "in flight" and status is preserved on reassignment/dissolve.
const PRE_FLIGHT_STATUSES: ReadonlyArray<OrderStatus> = [
  "pending",
  "rider_assigned",
  "rider_accepted",
];

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

// =====================================================================
// Helpers
// =====================================================================

function tripListItemFromRow(args: {
  trip: Trip;
  riderName: string | null;
  orderCount: number;
  stopCount: number;
  doneStopCount: number;
  skippedStopCount: number;
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
    doneStopCount: args.doneStopCount,
    skippedStopCount: args.skippedStopCount,
    createdAt: args.trip.createdAt,
    updatedAt: args.trip.updatedAt,
  };
}

/** Order statuses for the given ids, for deriving stop state (D6). */
async function statusesFor(
  orderIds: ReadonlyArray<string>,
): Promise<Map<string, OrderStatus>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({ id: ordersTable.id, status: ordersTable.status })
    .from(ordersTable)
    .where(and(inArray(ordersTable.id, [...orderIds]), isNull(ordersTable.archivedAt)));
  return new Map(rows.map((r) => [r.id, r.status]));
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
          .where(and(inArray(ordersTable.id, orderIds), isNull(ordersTable.archivedAt)))
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
        .select({
          id: restaurantsTable.id,
          name: restaurantsTable.name,
          address: restaurantsTable.address,
        })
        .from(restaurantsTable)
        .where(inArray(restaurantsTable.id, restaurantIds))
    : [];
  const restName = new Map(restRows.map((r) => [r.id, r.name]));
  const restAddress = new Map(restRows.map((r) => [r.id, r.address]));

  let riderName: string | null = null;
  if (trip.riderId) {
    const [r] = await db
      .select({ name: usersTable.name })
      .from(ridersTable)
      .innerJoin(usersTable, eq(usersTable.id, ridersTable.userId))
      .where(eq(ridersTable.id, trip.riderId));
    riderName = r?.name ?? null;
  }

  const visibleStops = stops.filter((s) => orderById.has(s.orderId));
  const stopsWithOrder = visibleStops.map((s) => {
    const o = orderById.get(s.orderId);
    const status = o?.status ?? "pending";
    return {
      id: s.id,
      orderId: s.orderId,
      kind: s.kind,
      sequence: s.sequence,
      state: stopStateFor(s.kind, status),
      externalOrderId: o?.externalOrderId ?? "",
      customerName: o?.customerName ?? "",
      customerPhone: o?.customerPhone ?? "",
      restaurantId: o?.restaurantId ?? "",
      restaurantName: restName.get(o?.restaurantId ?? "") ?? "",
      restaurantAddress: restAddress.get(o?.restaurantId ?? "") ?? "",
      deliveryAddress: o?.deliveryAddress ?? "",
      orderStatus: status,
      effectivePickupTime: o?.effectivePickupTime ?? new Date(0),
    };
  });

  const progress = tripProgress(
    visibleStops,
    new Map(serializedOrders.map((o) => [o.id, o.status])),
  );
  const list = tripListItemFromRow({
    trip,
    riderName,
    orderCount: new Set(visibleStops.map((s) => s.orderId)).size,
    ...progress,
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

    // Admin/coordinator unrestricted. Riders see only their own trips.
    // Everyone else (e.g. restaurant_staff-only) has no read access to trips.
    if (auth.roles.includes("admin") || auth.roles.includes("coordinator")) {
      // unrestricted
    } else if (auth.roles.includes("rider")) {
      if (!auth.riderId) {
        res.json([]);
        return;
      }
      filters.push(eq(tripsTable.riderId, auth.riderId));
    } else {
      res.json([]);
      return;
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
    const statusByOrderId = await statusesFor(
      Array.from(new Set(stops.map((s) => s.orderId))),
    );

    const views = rows.map((trip) => {
      const tripStops = stops.filter(
        (s) => s.tripId === trip.id && statusByOrderId.has(s.orderId),
      );
      const orderCount = new Set(tripStops.map((s) => s.orderId)).size;
      return tripListItemFromRow({
        trip,
        riderName: trip.riderId ? (riderNameById.get(trip.riderId) ?? null) : null,
        orderCount,
        ...tripProgress(tripStops, statusByOrderId),
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

    // Authorization: riders can only read their own trips. Admin/coordinator
    // unrestricted. Everyone else (e.g. restaurant_staff-only) is blocked.
    if (auth.roles.includes("admin") || auth.roles.includes("coordinator")) {
      // unrestricted
    } else if (auth.roles.includes("rider")) {
      if (!auth.riderId || detail.riderId !== auth.riderId) {
        throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
      }
    } else {
      throw httpError(403, "FORBIDDEN", "Forbidden");
    }
    res.json(detail);
  }),
);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Attaches `orders` to `trip` (assumed locked with `for("update")` by the
 * caller already). Shared between trip creation and adding orders to an
 * existing trip so both go through the exact same rider-attach rules: a
 * pending order with a trip rider skips straight to rider_accepted (same as
 * self-claim); anything else already matching that rider just gets the
 * tripId link.
 */
async function attachOrdersToTrip(
  tx: Tx,
  trip: Pick<Trip, "id" | "tripNumber" | "riderId">,
  orders: Order[],
  auth: NonNullable<Request["auth"]>,
): Promise<void> {
  const riderId = trip.riderId;
  for (const o of orders) {
    if (riderId && o.status === "pending") {
      const upd = await tx
        .update(ordersTable)
        .set({ tripId: trip.id, riderId, status: "rider_accepted" })
        .where(
          and(
            eq(ordersTable.id, o.id),
            eq(ordersTable.status, "pending"),
            sql`${ordersTable.tripId} is null`,
            isNull(ordersTable.archivedAt),
          ),
        )
        .returning();
      if (upd.length === 0) {
        throw httpError(409, "STATE_CONFLICT", `Order ${o.externalOrderId} state changed concurrently`);
      }
      await tx.insert(orderStatusLogsTable).values({
        orderId: o.id,
        fromStatus: "pending",
        toStatus: "rider_accepted",
        actorUserId: auth.sub,
        actorRole: primaryRoleLabel(auth.roles),
        note: `Bundled into trip #${trip.tripNumber}`,
      });
      await tx.insert(riderAssignmentsTable).values({
        orderId: o.id,
        riderId,
        outcome: "assigned",
        assignedByUserId: auth.sub,
      });
    } else {
      const upd = await tx
        .update(ordersTable)
        .set({ tripId: trip.id, ...(riderId ? { riderId } : {}) })
        .where(
          and(
            eq(ordersTable.id, o.id),
            eq(ordersTable.status, o.status),
            sql`${ordersTable.tripId} is null`,
            isNull(ordersTable.archivedAt),
          ),
        )
        .returning();
      if (upd.length === 0) {
        throw httpError(409, "STATE_CONFLICT", `Order ${o.externalOrderId} state changed concurrently`);
      }
    }
  }
}

/**
 * Detaches one order from `trip` (assumed locked by the caller already).
 * Shared between dissolving a whole trip and removing a single order:
 * pre-flight orders revert to pending and are unassigned; in-flight or
 * already-terminal orders keep their status/rider and just lose the trip
 * link, so an active delivery is never rewound by a trip-membership edit.
 */
async function detachOrderFromTrip(
  tx: Tx,
  trip: Pick<Trip, "id" | "tripNumber">,
  order: Order,
  auth: NonNullable<Request["auth"]>,
): Promise<void> {
  if (!PRE_FLIGHT_STATUSES.includes(order.status)) {
    await tx
      .update(ordersTable)
      .set({ tripId: null })
      .where(and(eq(ordersTable.id, order.id), eq(ordersTable.tripId, trip.id), isNull(ordersTable.archivedAt)));
    return;
  }

  const upd = await tx
    .update(ordersTable)
    .set({ tripId: null, riderId: null, status: "pending" })
    .where(
      and(
        eq(ordersTable.id, order.id),
        eq(ordersTable.tripId, trip.id),
        inArray(ordersTable.status, PRE_FLIGHT_STATUSES),
        isNull(ordersTable.archivedAt),
      ),
    )
    .returning();
  if (upd.length === 0) {
    // Status moved forward concurrently (rider advanced mid-request). Detach
    // without rewinding status/rider rather than leaving it stuck on the trip.
    await tx
      .update(ordersTable)
      .set({ tripId: null })
      .where(and(eq(ordersTable.id, order.id), eq(ordersTable.tripId, trip.id), isNull(ordersTable.archivedAt)));
    return;
  }
  if (order.status !== "pending") {
    await tx.insert(orderStatusLogsTable).values({
      orderId: order.id,
      fromStatus: order.status,
      toStatus: "pending",
      actorUserId: auth.sub,
      actorRole: primaryRoleLabel(auth.roles),
      note: `Removed from trip #${trip.tripNumber}`,
    });
  }
  if (order.riderId) {
    await tx.insert(riderAssignmentsTable).values({
      orderId: order.id,
      riderId: order.riderId,
      outcome: "unassigned",
      assignedByUserId: auth.sub,
    });
  }
}

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

    const riderId = body.riderId ?? null;

    const { trip, ordersForPush } = await db.transaction(async (tx) => {
      const orders = await tx
        .select()
        .from(ordersTable)
        .where(and(inArray(ordersTable.id, uniqueOrderIds), isNull(ordersTable.archivedAt)));
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
        if (!PRE_FLIGHT_STATUSES.includes(o.status)) {
          throw httpError(
            422,
            "ORDER_NOT_BUNDLEABLE",
            `Order ${o.externalOrderId} is not bundleable in status ${o.status}`,
          );
        }
      }

      if (riderId) {
        const [rider] = await tx
          .select({ id: ridersTable.id })
          .from(ridersTable)
          .where(eq(ridersTable.id, riderId));
        if (!rider) throw httpError(404, "RIDER_NOT_FOUND", "Rider not found");
      }

      const [createdTrip] = await tx
        .insert(tripsTable)
        .values({
          name: body.name ?? null,
          riderId,
          status: "planned",
          createdByUserId: auth.sub,
        })
        .returning();
      if (!createdTrip) throw httpError(500, "DB_ERROR", "Failed to create trip");

      const stops = buildDefaultStops(orders, uniqueOrderIds);
      await tx.insert(tripStopsTable).values(
        stops.map((s) => ({
          tripId: createdTrip.id,
          orderId: s.orderId,
          kind: s.kind,
          sequence: s.sequence,
        })),
      );

      // Attach orders. If riderId provided, also assign pending orders
      // (pending → rider_accepted — trip assignment skips the rider_assigned
      // accept step, same as self-claim) using a conditional update so a
      // concurrent change is detected.
      await attachOrdersToTrip(tx, createdTrip, orders, auth);

      return { trip: createdTrip, ordersForPush: orders };
    });

    // Push: notify the rider (if assigned) and coordinators. Run after commit.
    if (riderId) {
      const audience = audienceForTripAssigned();
      await Promise.all([
        sendPushToRider(riderId, {
          title: `Nieuwe rit toegewezen — Trip #${trip.tripNumber}`,
          body: `${ordersForPush.length} orders`,
          data: { tripId: trip.id, type: "trip.assigned" },
        }),
        sendPushToRoles(audience.roles, {
          title: `Trip #${trip.tripNumber} aangemaakt`,
          body: `${ordersForPush.length} orders`,
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
    const body = req.body as {
      name?: string | null;
      riderId?: string | null;
      force?: boolean;
    };

    const { trip, tripOrdersCount } = await db.transaction(async (tx) => {
      // Lock the trip row to serialize concurrent edits/dissolves on the
      // same trip. Terminal-state checks below are then safe within tx.
      const [trip] = await tx
        .select()
        .from(tripsTable)
        .where(eq(tripsTable.id, id))
        .for("update");
      if (!trip) throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
      if (trip.status === "dissolved" || trip.status === "completed") {
        throw httpError(422, "TRIP_TERMINAL", "Trip is no longer editable");
      }

      const updates: Partial<typeof tripsTable.$inferInsert> = {};
      if (body.name !== undefined) updates.name = body.name ?? null;
      if (body.riderId !== undefined) {
        const newRiderId = body.riderId ?? null;
        if (newRiderId) {
          const [rider] = await tx
            .select({ id: ridersTable.id })
            .from(ridersTable)
            .where(eq(ridersTable.id, newRiderId));
          if (!rider) throw httpError(404, "RIDER_NOT_FOUND", "Rider not found");
        }
        updates.riderId = newRiderId;
      }
      if (Object.keys(updates).length > 0) {
        await tx
          .update(tripsTable)
          .set(updates)
          .where(
            and(
              eq(tripsTable.id, id),
              sql`${tripsTable.status} not in ('dissolved','completed')`,
            ),
          );
      }

      let tripOrdersCount = 0;
      // If rider changed, propagate to non-terminal orders on the trip.
      if (body.riderId !== undefined) {
        const newRiderId = body.riderId ?? null;
        const tripOrders = await tx
          .select()
          .from(ordersTable)
          .where(and(eq(ordersTable.tripId, id), isNull(ordersTable.archivedAt)));
        tripOrdersCount = tripOrders.length;

        // Identify in-flight orders: past the pre-flight stage but not yet in
        // a terminal state. We never lock the coordinator out, but we require
        // an explicit `force: true` so the choice is conscious.
        const inFlight = tripOrders.filter(
          (o) =>
            !PRE_FLIGHT_STATUSES.includes(o.status) &&
            o.status !== "delivered" &&
            o.status !== "failed",
        );
        const riderActuallyChanges =
          newRiderId !== (trip.riderId ?? null) && inFlight.length > 0;
        if (riderActuallyChanges && body.force !== true) {
          throw httpError(
            409,
            "INFLIGHT_REASSIGN_REQUIRES_CONFIRM",
            "Some orders on this trip are already in motion. Confirm to reassign.",
            {
              inFlightOrders: inFlight.map((o) => ({
                id: o.id,
                externalOrderId: o.externalOrderId,
                status: o.status,
              })),
            },
          );
        }

        for (const o of tripOrders) {
          // Terminal orders never change rider.
          if (o.status === "delivered" || o.status === "failed") continue;

          // In-flight orders: with force=true, swap the rider but preserve
          // the current status (no rewind of an in-flight leg). Without
          // force we would have already returned 409 above.
          if (!PRE_FLIGHT_STATUSES.includes(o.status)) {
            if (newRiderId !== null && o.riderId !== newRiderId) {
              const upd = await tx
                .update(ordersTable)
                .set({ riderId: newRiderId })
                .where(
                  and(
                    eq(ordersTable.id, o.id),
                    eq(ordersTable.tripId, id),
                    eq(ordersTable.status, o.status),
                isNull(ordersTable.archivedAt),
                  ),
                )
                .returning();
              if (upd.length === 0) continue;
              await tx.insert(orderStatusLogsTable).values({
                orderId: o.id,
                fromStatus: o.status,
                toStatus: o.status,
                actorUserId: auth.sub,
                actorRole: primaryRoleLabel(auth.roles),
                note: `Trip #${trip.tripNumber} rider reassigned mid-flight (status preserved)`,
              });
              await tx.insert(riderAssignmentsTable).values({
                orderId: o.id,
                riderId: newRiderId,
                outcome: "reassigned",
                assignedByUserId: auth.sub,
              });
            }
            continue;
          }

          if (newRiderId == null) {
            const upd = await tx
              .update(ordersTable)
              .set({ riderId: null, status: "pending" })
              .where(
                and(
                  eq(ordersTable.id, o.id),
                  eq(ordersTable.tripId, id),
                  inArray(ordersTable.status, PRE_FLIGHT_STATUSES),
                ),
              )
              .returning();
            if (upd.length === 0) continue;
            await tx.insert(orderStatusLogsTable).values({
              orderId: o.id,
              fromStatus: o.status,
              toStatus: "pending",
              actorUserId: auth.sub,
              actorRole: primaryRoleLabel(auth.roles),
              note: `Trip #${trip.tripNumber} unassigned`,
            });
            await tx.insert(riderAssignmentsTable).values({
              orderId: o.id,
              riderId: o.riderId,
              outcome: "unassigned",
              assignedByUserId: auth.sub,
            });
          } else if (o.riderId !== newRiderId) {
            const upd = await tx
              .update(ordersTable)
              .set({ riderId: newRiderId, status: "rider_accepted" })
              .where(
                and(
                  eq(ordersTable.id, o.id),
                  eq(ordersTable.tripId, id),
                  inArray(ordersTable.status, PRE_FLIGHT_STATUSES),
                isNull(ordersTable.archivedAt),
                ),
              )
              .returning();
            if (upd.length === 0) continue;
            if (o.status !== "rider_accepted") {
              await tx.insert(orderStatusLogsTable).values({
                orderId: o.id,
                fromStatus: o.status,
                toStatus: "rider_accepted",
                actorUserId: auth.sub,
                actorRole: primaryRoleLabel(auth.roles),
                note: `Trip #${trip.tripNumber} reassigned`,
              });
            }
            await tx.insert(riderAssignmentsTable).values({
              orderId: o.id,
              riderId: newRiderId,
              outcome: o.riderId ? "reassigned" : "assigned",
              assignedByUserId: auth.sub,
            });
          }
        }
      }

      return { trip: { ...trip, ...updates }, tripOrdersCount };
    });

    if (body.riderId !== undefined) {
      const newRiderId = body.riderId ?? null;
      if (newRiderId) {
        await sendPushToRider(newRiderId, {
          title: `Trip #${trip.tripNumber} toegewezen`,
          body: trip.name ?? `${tripOrdersCount} orders`,
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

    await db.transaction(async (tx) => {
      const [trip] = await tx
        .select()
        .from(tripsTable)
        .where(eq(tripsTable.id, id))
        .for("update");
      if (!trip) throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
      if (trip.status === "dissolved" || trip.status === "completed") {
        throw httpError(422, "TRIP_TERMINAL", "Trip is no longer editable");
      }

      const tripOrders = await tx
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(and(eq(ordersTable.tripId, id), isNull(ordersTable.archivedAt)));
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

      // Stops carry no progress of their own (D6) — it is derived from the
      // orders, which this does not touch. So replacing them wholesale is
      // safe; there is nothing to carry across.
      await tx.delete(tripStopsTable).where(eq(tripStopsTable.tripId, id));
      await tx.insert(tripStopsTable).values(
        inputStops.map((s, i) => ({
          tripId: id,
          orderId: s.orderId,
          kind: s.kind,
          sequence: i,
        })),
      );
    });

    const detail = await loadTripDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /trips/:id/orders — add orders to an existing trip
// =====================================================================
router.post(
  "/trips/:id/orders",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const body = req.body as { orderIds?: string[] };
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds : [];
    if (orderIds.length === 0) {
      throw httpError(400, "VALIDATION_ERROR", "orderIds required");
    }
    const uniqueOrderIds = Array.from(new Set(orderIds));
    if (uniqueOrderIds.length !== orderIds.length) {
      throw httpError(400, "VALIDATION_ERROR", "Duplicate orderIds");
    }

    await db.transaction(async (tx) => {
      const [trip] = await tx.select().from(tripsTable).where(eq(tripsTable.id, id)).for("update");
      if (!trip) throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
      if (trip.status === "dissolved" || trip.status === "completed") {
        throw httpError(422, "TRIP_TERMINAL", "Trip is no longer editable");
      }

      const orders = await tx
        .select()
        .from(ordersTable)
        .where(and(inArray(ordersTable.id, uniqueOrderIds), isNull(ordersTable.archivedAt)));
      if (orders.length !== uniqueOrderIds.length) {
        throw httpError(404, "ORDER_NOT_FOUND", "One or more orders missing");
      }
      for (const o of orders) {
        if (o.tripId) {
          throw httpError(409, "ORDER_ON_TRIP", `Order ${o.externalOrderId} is already on a trip`);
        }
        if (!PRE_FLIGHT_STATUSES.includes(o.status)) {
          throw httpError(
            422,
            "ORDER_NOT_BUNDLEABLE",
            `Order ${o.externalOrderId} is not bundleable in status ${o.status}`,
          );
        }
      }

      // New stops go after the trip's existing ones — reorder afterward via
      // PUT /trips/:id/stops if needed, same as the coordinator already does
      // with a trip's original stops.
      const existingStops = await tx
        .select({ sequence: tripStopsTable.sequence })
        .from(tripStopsTable)
        .where(eq(tripStopsTable.tripId, id));
      const nextSequence = existingStops.length
        ? Math.max(...existingStops.map((s) => s.sequence)) + 1
        : 0;
      const newStops = buildDefaultStops(orders, uniqueOrderIds);
      await tx.insert(tripStopsTable).values(
        newStops.map((s, i) => ({
          tripId: id,
          orderId: s.orderId,
          kind: s.kind,
          sequence: nextSequence + i,
        })),
      );

      await attachOrdersToTrip(tx, trip, orders, auth);
    });

    const detail = await loadTripDetail(id);
    if (detail?.riderId) {
      const audience = audienceForTripAssigned();
      await Promise.all([
        sendPushToRider(detail.riderId, {
          title: `Trip #${detail.tripNumber} bijgewerkt`,
          body: `${orderIds.length} order(s) toegevoegd`,
          data: { tripId: id, type: "trip.assigned" },
        }),
        sendPushToRoles(audience.roles, {
          title: `Trip #${detail.tripNumber} bijgewerkt`,
          body: `${orderIds.length} order(s) toegevoegd`,
          data: { tripId: id, type: "trip.assigned" },
        }),
      ]);
    }
    res.json(detail);
  }),
);

// =====================================================================
// DELETE /trips/:id/orders/:orderId — remove one order from a trip
// =====================================================================
router.delete(
  "/trips/:id/orders/:orderId",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const orderId = req.params["orderId"] as string;
    const auth = req.auth!;

    await db.transaction(async (tx) => {
      const [trip] = await tx.select().from(tripsTable).where(eq(tripsTable.id, id)).for("update");
      if (!trip) throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
      if (trip.status === "dissolved" || trip.status === "completed") {
        throw httpError(422, "TRIP_TERMINAL", "Trip is no longer editable");
      }

      const [order] = await tx
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.tripId, id), isNull(ordersTable.archivedAt)));
      if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Order is not on this trip");

      await detachOrderFromTrip(tx, trip, order, auth);
      await tx
        .delete(tripStopsTable)
        .where(and(eq(tripStopsTable.tripId, id), eq(tripStopsTable.orderId, orderId)));
    });

    // Outside the transaction: re-checks the trip's current order set, which
    // this removal may have just emptied out or reduced to all-terminal.
    await completeTripIfDone(id);

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

    const { trip, tripOrders } = await db.transaction(async (tx) => {
      const [trip] = await tx
        .select()
        .from(tripsTable)
        .where(eq(tripsTable.id, id))
        .for("update");
      if (!trip) throw httpError(404, "TRIP_NOT_FOUND", "Trip not found");
      if (trip.status === "dissolved" || trip.status === "completed") {
        throw httpError(422, "TRIP_TERMINAL", "Trip already terminal");
      }
      // Riders may only dissolve their own trip; admin/coordinator unrestricted.
      const hasBroadAccess = auth.roles.includes("admin") || auth.roles.includes("coordinator");
      if (!hasBroadAccess && auth.roles.includes("rider")) {
        if (!auth.riderId || trip.riderId !== auth.riderId) {
          throw httpError(403, "FORBIDDEN", "Forbidden");
        }
      }

      const tripOrders = await tx
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.tripId, id), isNull(ordersTable.archivedAt)));

      for (const o of tripOrders) {
        // Pre-flight orders revert to pending; in-flight keep status/rider
        // but detach from the trip. Re-check the order's current status in
        // the UPDATE so a concurrent rider advance (e.g. rider_accepted →
        // picked_up committed between our SELECT and UPDATE) is not silently
        // rewound to pending.
        if (PRE_FLIGHT_STATUSES.includes(o.status)) {
          const upd = await tx
            .update(ordersTable)
            .set({ tripId: null, riderId: null, status: "pending" })
            .where(
              and(
                eq(ordersTable.id, o.id),
                eq(ordersTable.tripId, id),
                inArray(ordersTable.status, PRE_FLIGHT_STATUSES),
                isNull(ordersTable.archivedAt),
              ),
            )
            .returning();
          if (upd.length === 0) {
            // Status moved forward concurrently (or the order was moved to
            // another trip). If still on this trip but in-flight, just detach
            // without rewinding status/rider; otherwise leave alone.
            await tx
              .update(ordersTable)
              .set({ tripId: null })
              .where(
                and(
                  eq(ordersTable.id, o.id),
                  eq(ordersTable.tripId, id),
                  isNull(ordersTable.archivedAt),
                ),
              );
            continue;
          }
          if (o.status !== "pending") {
            await tx.insert(orderStatusLogsTable).values({
              orderId: o.id,
              fromStatus: o.status,
              toStatus: "pending",
              actorUserId: auth.sub,
              actorRole: primaryRoleLabel(auth.roles),
              note: `Trip #${trip.tripNumber} dissolved`,
            });
          }
          if (o.riderId) {
            await tx.insert(riderAssignmentsTable).values({
              orderId: o.id,
              riderId: o.riderId,
              outcome: "unassigned",
              assignedByUserId: auth.sub,
            });
          }
        } else {
          await tx
            .update(ordersTable)
            .set({ tripId: null })
            .where(
              and(
                eq(ordersTable.id, o.id),
                eq(ordersTable.tripId, id),
                isNull(ordersTable.archivedAt),
              ),
            );
        }
      }

      await tx
        .update(tripsTable)
        .set({ status: "dissolved" })
        .where(eq(tripsTable.id, id));

      return { trip, tripOrders };
    });

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
