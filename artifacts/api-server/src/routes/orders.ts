import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderStatusLogsTable,
  itemOverridesTable,
  pickupTimeAdjustmentsTable,
  riderAssignmentsTable,
  ridersTable,
  restaurantsTable,
  type OrderStatus,
} from "@workspace/db";
import {
  IngestOrderBody,
  TransitionOrderStatusBody,
  AssignOrderBody,
  UpdatePickupTimeBody,
  HideOrderItemBody,
  AddOrderItemBody,
  SetRiderNotificationBody,
  UpdateOrderContactBody,
  ListOrdersQueryParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole, requireInboundSecret } from "../lib/auth";
import { httpError } from "../lib/errors";
import { assertValidTransition } from "../lib/state-machine";
import {
  serializeOrderDetail,
  serializeOrderListItems,
} from "../lib/order-serialize";
import { enqueueOutboundEvent } from "../lib/webhook";
import {
  sendPushToRoles,
  sendPushToRider,
  sendPushToRestaurantStaff,
} from "../lib/push";
import {
  audienceForNewOrder,
  audienceForAssignment,
  audienceForStatus,
} from "../lib/push-triggers";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

async function loadOrderOr404(id: string) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id));
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Order not found");
  return order;
}

function assertOrderVisible(order: { restaurantId: string; riderId: string | null }, req: Request): void {
  const auth = req.auth!;
  if (auth.role === "admin" || auth.role === "coordinator") return;
  if (auth.role === "restaurant_staff") {
    if (auth.restaurantId === order.restaurantId) return;
    throw httpError(403, "FORBIDDEN", "Forbidden");
  }
  if (auth.role === "rider") {
    // Rider can read pending (queue visibility) or orders assigned to them.
    if (order.riderId === null) return;
    if (auth.riderId && order.riderId === auth.riderId) return;
    throw httpError(403, "FORBIDDEN", "Forbidden");
  }
  throw httpError(403, "FORBIDDEN", "Forbidden");
}

// =====================================================================
// POST /inbound/orders — upstream ingestion
// =====================================================================
router.post(
  "/inbound/orders",
  requireInboundSecret,
  wrap(async (req, res) => {
    const parsed = IngestOrderBody.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    }
    const payload = parsed.data;

    const [restaurant] = await db
      .select()
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, payload.restaurantId));
    if (!restaurant) {
      throw httpError(400, "UNKNOWN_RESTAURANT", "Restaurant not found");
    }

    const minMinutes = restaurant.minDeliveryTime ?? 30;
    const pickupTimeOriginal = new Date(Date.now() + minMinutes * 60_000);

    const items = payload.items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      price: it.price,
      ...(it.notes != null ? { notes: it.notes } : {}),
    }));

    // Idempotent on externalOrderId. Use insert-only first to detect race-safe
    // brand-new vs replay; on replay update only mutable fields.
    const inserted = await db
      .insert(ordersTable)
      .values({
        externalOrderId: payload.orderId,
        restaurantId: payload.restaurantId,
        customerName: payload.customer.name,
        customerPhone: payload.customer.phone,
        customerEmail: payload.customer.email ?? null,
        deliveryAddress: payload.customer.address,
        deliveryInstructions: payload.deliveryInstructions ?? null,
        deliveryFee: payload.deliveryFee,
        totalAmount: payload.totalAmount,
        items,
        originalPayload: payload as unknown as Record<string, unknown>,
        pickupTimeOriginal,
      })
      .onConflictDoNothing({ target: ordersTable.externalOrderId })
      .returning();

    let row: typeof ordersTable.$inferSelect | undefined = inserted[0];
    const isNew = Boolean(row);
    if (!row) {
      // Replay: update mutable customer/items/payload fields; never touch
      // status, riderId, pickupTimeOriginal.
      const updated = await db
        .update(ordersTable)
        .set({
          customerName: payload.customer.name,
          customerPhone: payload.customer.phone,
          customerEmail: payload.customer.email ?? null,
          deliveryAddress: payload.customer.address,
          deliveryInstructions: payload.deliveryInstructions ?? null,
          deliveryFee: payload.deliveryFee,
          totalAmount: payload.totalAmount,
          items,
          originalPayload: payload as unknown as Record<string, unknown>,
        })
        .where(eq(ordersTable.externalOrderId, payload.orderId))
        .returning();
      row = updated[0];
    }
    if (!row) throw httpError(500, "DB_ERROR", "Failed to insert or update order");

    if (isNew) {
      await db.insert(orderStatusLogsTable).values({
        orderId: row.id,
        fromStatus: null,
        toStatus: "pending",
        actorUserId: null,
        actorRole: "system",
        note: "Ingested from upstream",
      });
      const audience = audienceForNewOrder();
      await Promise.all([
        sendPushToRoles(audience.roles, {
          title: "Nieuwe bestelling",
          body: `${row.customerName} — ${restaurant.name}`,
          data: { orderId: row.id, type: "order.created" },
        }),
        audience.notifyOrderRestaurantStaff
          ? sendPushToRestaurantStaff(row.restaurantId, {
              title: "Nieuwe bestelling",
              body: `${row.customerName}`,
              data: { orderId: row.id, type: "order.created" },
            })
          : Promise.resolve(),
        enqueueOutboundEvent({
          eventType: "order.created",
          orderId: row.id,
          payload: { externalOrderId: row.externalOrderId, status: row.status },
        }),
      ]);
    }

    const detail = await serializeOrderDetail(row.id);
    res.status(200).json(detail);
  }),
);

// =====================================================================
// GET /orders — list, scoped by role
// =====================================================================
router.get(
  "/orders",
  requireAuth,
  wrap(async (req, res) => {
    const auth = req.auth!;
    const parsed = ListOrdersQueryParams.safeParse(req.query);
    if (!parsed.success) {
      throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    }
    const { status, restaurantId, riderId, q } = parsed.data;

    const filters = [] as ReturnType<typeof eq>[];
    if (status) filters.push(eq(ordersTable.status, status));
    if (restaurantId) filters.push(eq(ordersTable.restaurantId, restaurantId));
    if (riderId) filters.push(eq(ordersTable.riderId, riderId));

    // Role-based scoping.
    if (auth.role === "restaurant_staff") {
      if (!auth.restaurantId) {
        res.json([]);
        return;
      }
      filters.push(eq(ordersTable.restaurantId, auth.restaurantId));
    } else if (auth.role === "rider") {
      const [rider] = await db
        .select({ id: ridersTable.id })
        .from(ridersTable)
        .where(eq(ridersTable.userId, auth.sub));
      if (!rider) {
        res.json([]);
        return;
      }
      // Riders see pending (so they can pick) plus their own assigned orders.
      filters.push(
        or(
          eq(ordersTable.status, "pending"),
          eq(ordersTable.riderId, rider.id),
        )!,
      );
    }

    if (q) {
      const term = `%${q}%`;
      filters.push(
        or(
          ilike(ordersTable.customerName, term),
          ilike(ordersTable.deliveryAddress, term),
          ilike(ordersTable.externalOrderId, term),
        )!,
      );
    }

    const where = filters.length ? and(...filters) : undefined;
    const rows = await db
      .select()
      .from(ordersTable)
      .where(where)
      .orderBy(desc(ordersTable.createdAt))
      .limit(500);
    const list = await serializeOrderListItems(rows);
    res.json(list);
  }),
);

// =====================================================================
// GET /orders/:id — detail
// =====================================================================
router.get(
  "/orders/:id",
  requireAuth,
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const order = await loadOrderOr404(id);
    assertOrderVisible(order, req);
    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/status — state machine transition
// =====================================================================
router.post(
  "/orders/:id/status",
  requireAuth,
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const parsed = TransitionOrderStatusBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);

    const order = await loadOrderOr404(id);
    const toStatus = parsed.data.toStatus as OrderStatus;
    assertValidTransition(order.status, toStatus);

    // Role permissions:
    // - Riders may transition only their own orders, and only forward.
    // - Restaurant staff may not transition.
    // - Admin/coordinator may always transition.
    if (auth.role === "rider") {
      const [rider] = await db
        .select({ id: ridersTable.id })
        .from(ridersTable)
        .where(eq(ridersTable.userId, auth.sub));
      if (!rider || rider.id !== order.riderId) {
        throw httpError(403, "FORBIDDEN", "Rider can only update their own orders");
      }
    } else if (auth.role === "restaurant_staff") {
      throw httpError(403, "FORBIDDEN", "Forbidden");
    }

    const updates: Partial<typeof ordersTable.$inferInsert> = { status: toStatus };
    if (toStatus === "failed") {
      updates.failureReason = parsed.data.failureReason ?? "Unspecified";
    }
    // Atomic guarded update — only transition if status is still what we read.
    const updated = await db
      .update(ordersTable)
      .set(updates)
      .where(and(eq(ordersTable.id, id), eq(ordersTable.status, order.status)))
      .returning();
    if (updated.length === 0) {
      throw httpError(409, "STATE_CONFLICT", "Order state changed concurrently");
    }

    await db.insert(orderStatusLogsTable).values({
      orderId: id,
      fromStatus: order.status,
      toStatus,
      actorUserId: auth.sub,
      actorRole: auth.role,
      note: parsed.data.note ?? null,
    });

    // Notifications.
    const audience = audienceForStatus(toStatus);
    if (audience) {
      const updatedOrder = updated[0]!;
      await Promise.all([
        audience.roles.length > 0
          ? sendPushToRoles(audience.roles, {
              title: `Status: ${toStatus}`,
              body: `${order.customerName}`,
              data: { orderId: id, type: "order.status_changed", status: toStatus },
            })
          : Promise.resolve(),
        audience.notifyAssignedRider && updatedOrder.riderId
          ? sendPushToRider(updatedOrder.riderId, {
              title: `Status: ${toStatus}`,
              body: order.customerName,
              data: { orderId: id, type: "order.status_changed", status: toStatus },
            })
          : Promise.resolve(),
        audience.notifyOrderRestaurantStaff
          ? sendPushToRestaurantStaff(order.restaurantId, {
              title: `Status: ${toStatus}`,
              body: order.customerName,
              data: { orderId: id, type: "order.status_changed", status: toStatus },
            })
          : Promise.resolve(),
      ]);
    }
    await enqueueOutboundEvent({
      eventType: "order.status_changed",
      orderId: id,
      payload: { fromStatus: order.status, toStatus, note: parsed.data.note ?? null },
    });

    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/assign — atomic rider assignment
// =====================================================================
router.post(
  "/orders/:id/assign",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const parsed = AssignOrderBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const { riderId } = parsed.data;

    const [rider] = await db
      .select()
      .from(ridersTable)
      .where(eq(ridersTable.id, riderId));
    if (!rider) throw httpError(404, "RIDER_NOT_FOUND", "Rider not found");

    // Atomic claim: only succeeds if status is still 'pending' AND no rider yet.
    const updated = await db
      .update(ordersTable)
      .set({ status: "driver_assigned", riderId })
      .where(
        and(
          eq(ordersTable.id, id),
          eq(ordersTable.status, "pending"),
          sql`${ordersTable.riderId} IS NULL`,
        ),
      )
      .returning();

    if (updated.length === 0) {
      // Determine reason: order absent, or already not pending.
      const [exists] = await db
        .select({ id: ordersTable.id, status: ordersTable.status })
        .from(ordersTable)
        .where(eq(ordersTable.id, id));
      if (!exists) throw httpError(404, "ORDER_NOT_FOUND", "Order not found");
      throw httpError(409, "ALREADY_ASSIGNED", "Order is no longer pending");
    }

    await Promise.all([
      db.insert(orderStatusLogsTable).values({
        orderId: id,
        fromStatus: "pending",
        toStatus: "driver_assigned",
        actorUserId: auth.sub,
        actorRole: auth.role,
        note: `Assigned rider ${riderId}`,
      }),
      db.insert(riderAssignmentsTable).values({
        orderId: id,
        riderId,
        outcome: "assigned",
        assignedByUserId: auth.sub,
      }),
    ]);

    const order = updated[0]!;
    const audience = audienceForAssignment();
    await Promise.all([
      audience.notifyAssignedRider
        ? sendPushToRider(riderId, {
            title: "Nieuwe rit toegewezen",
            body: order.customerName,
            data: { orderId: id, type: "order.assigned" },
          })
        : Promise.resolve(),
      audience.notifyOrderRestaurantStaff
        ? sendPushToRestaurantStaff(order.restaurantId, {
            title: "Bezorger toegewezen",
            body: order.customerName,
            data: { orderId: id, type: "order.assigned" },
          })
        : Promise.resolve(),
      enqueueOutboundEvent({
        eventType: "order.assigned",
        orderId: id,
        payload: { riderId },
      }),
    ]);

    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/pickup-time — multi-source priority
// =====================================================================
router.post(
  "/orders/:id/pickup-time",
  requireAuth,
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const parsed = UpdatePickupTimeBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const { source, pickupTime } = parsed.data;

    const order = await loadOrderOr404(id);
    assertOrderVisible(order, req);

    // Per-source role authorization.
    if (source === "rider") {
      if (auth.role !== "rider")
        throw httpError(403, "FORBIDDEN", "Only riders may update pickupTimeRider");
      const [rider] = await db
        .select({ id: ridersTable.id })
        .from(ridersTable)
        .where(eq(ridersTable.userId, auth.sub));
      if (!rider || rider.id !== order.riderId) {
        throw httpError(403, "FORBIDDEN", "Rider can only update their own orders");
      }
    } else if (source === "restaurant") {
      if (
        auth.role !== "restaurant_staff" &&
        auth.role !== "admin" &&
        auth.role !== "coordinator"
      ) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }
      if (
        auth.role === "restaurant_staff" &&
        auth.restaurantId !== order.restaurantId
      ) {
        throw httpError(403, "FORBIDDEN", "Forbidden");
      }
    } else if (source === "override") {
      if (auth.role !== "admin" && auth.role !== "coordinator") {
        throw httpError(403, "FORBIDDEN", "Only coordinators may override pickup time");
      }
    }

    const fieldMap = {
      rider: "pickupTimeRider",
      restaurant: "pickupTimeRestaurant",
      override: "pickupTimeOverride",
    } as const;
    const previous =
      source === "rider"
        ? order.pickupTimeRider
        : source === "restaurant"
          ? order.pickupTimeRestaurant
          : order.pickupTimeOverride;

    const newValueDb = pickupTime instanceof Date ? pickupTime : null;
    const updates: Partial<typeof ordersTable.$inferInsert> = {};
    (updates as Record<string, Date | null>)[fieldMap[source]] = newValueDb;

    await db.update(ordersTable).set(updates).where(eq(ordersTable.id, id));

    if (newValueDb) {
      await db.insert(pickupTimeAdjustmentsTable).values({
        orderId: id,
        source,
        previousValue: previous,
        newValue: newValueDb,
        actorUserId: auth.sub,
        actorRole: auth.role,
      });
    }

    await enqueueOutboundEvent({
      eventType: "order.pickup_time_updated",
      orderId: id,
      payload: { source, pickupTime: newValueDb?.toISOString() ?? null },
    });

    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/items/hide
// =====================================================================
router.post(
  "/orders/:id/items/hide",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const parsed = HideOrderItemBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const order = await loadOrderOr404(id);
    if (
      parsed.data.itemIndex < 0 ||
      parsed.data.itemIndex >= (order.items?.length ?? 0)
    ) {
      throw httpError(400, "INVALID_ITEM_INDEX", "Item index out of range");
    }
    await db.insert(itemOverridesTable).values({
      orderId: id,
      type: "hide",
      itemIndex: parsed.data.itemIndex,
      addedItem: null,
      createdByUserId: auth.sub,
    });
    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/items/add
// =====================================================================
router.post(
  "/orders/:id/items/add",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const parsed = AddOrderItemBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    await loadOrderOr404(id);
    const item = parsed.data.item;
    await db.insert(itemOverridesTable).values({
      orderId: id,
      type: "add",
      itemIndex: null,
      addedItem: {
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        ...(item.notes != null ? { notes: item.notes } : {}),
      },
      createdByUserId: auth.sub,
    });
    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/notification — banner to assigned rider
// =====================================================================
router.post(
  "/orders/:id/notification",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = SetRiderNotificationBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const order = await loadOrderOr404(id);
    const message = parsed.data.message?.trim() || null;
    await db
      .update(ordersTable)
      .set({ pendingRiderNotification: message })
      .where(eq(ordersTable.id, id));

    if (message && order.riderId) {
      await sendPushToRider(order.riderId, {
        title: "Bericht van coördinator",
        body: message,
        data: { orderId: id, type: "order.notification" },
      });
    }
    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/contact — override delivery address / customer info
// =====================================================================
router.post(
  "/orders/:id/contact",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = UpdateOrderContactBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    await loadOrderOr404(id);
    const updates: Partial<typeof ordersTable.$inferInsert> = {};
    if (parsed.data.customerName !== undefined) updates.customerName = parsed.data.customerName;
    if (parsed.data.customerPhone !== undefined) updates.customerPhone = parsed.data.customerPhone;
    if (parsed.data.customerEmail !== undefined) updates.customerEmail = parsed.data.customerEmail ?? null;
    if (parsed.data.deliveryAddress !== undefined) updates.deliveryAddress = parsed.data.deliveryAddress;
    if (parsed.data.deliveryInstructions !== undefined) {
      updates.deliveryInstructions = parsed.data.deliveryInstructions ?? null;
    }
    if (Object.keys(updates).length > 0) {
      await db.update(ordersTable).set(updates).where(eq(ordersTable.id, id));
    }
    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// Avoid unused import warnings.
void asc;

export default router;
