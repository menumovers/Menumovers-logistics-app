import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
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
  type Restaurant,
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
  HoldOrderBody,
  SetOrderRestaurantBody,
  AcknowledgeOrderBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole, requireInboundCredential } from "../lib/auth";
import { httpError } from "../lib/errors";
import { assertValidTransition } from "../lib/state-machine";
import {
  serializeOrderDetail,
  serializeOrderListItems,
} from "../lib/order-serialize";
import { enqueueOutboundEvent } from "../lib/webhook";
import { resolveOriginalPickupTime, leadTimeMinutes } from "../lib/pickup-time";
import { SETTINGS, readSetting } from "../lib/settings-registry";
import { notHeld } from "../lib/order-hold";
import { isRiderDeliverable, riderDeliverable } from "../lib/delivery-method";
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

// nameCode of the seeded placeholder restaurant that parked orders are filed
// against when their externalRestaurantId doesn't resolve. Provisioned out of
// band (see scripts/src/seed-unmapped-restaurant.ts) — not created here so a
// slow/failed seed fails loudly instead of silently spawning duplicates.
const UNMAPPED_RESTAURANT_NAME_CODE = "unmapped";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/**
 * Build a Drizzle WHERE predicate that scopes order rows to those the
 * authenticated principal is allowed to see. Authorization is enforced at
 * the SQL level rather than in application code so it cannot be bypassed by
 * route handlers that forget to call a guard.
 *
 * Returns `undefined` for admin/coordinator (unrestricted) and a predicate
 * encoding the role-specific filter otherwise. Returns `sql\`false\`` when
 * the principal can never see any rows (e.g. restaurant_staff with no
 * restaurant), to short-circuit safely without leaking other rows.
 */
function orderScopeWhere(auth: NonNullable<Request["auth"]>) {
  if (auth.role === "admin" || auth.role === "coordinator") return undefined;
  if (auth.role === "restaurant_staff") {
    if (!auth.restaurantId) return sql`false`;
    return eq(ordersTable.restaurantId, auth.restaurantId);
  }
  if (auth.role === "rider") {
    const ownAssigned = auth.riderId
      ? eq(ordersTable.riderId, auth.riderId)
      : sql`false`;
    return or(
      // Discovery: unclaimed work. Excludes held orders (not triaged, not
      // dispatchable) and customer-pickup orders (never rider work at all).
      // The rider's own assigned orders below are deliberately NOT filtered,
      // so placing a hold never makes an in-flight delivery vanish from the
      // rider's screen.
      and(
        eq(ordersTable.status, "pending"),
        sql`${ordersTable.riderId} IS NULL`,
        notHeld(),
        riderDeliverable(),
      )!,
      ownAssigned,
    )!;
  }
  return sql`false`;
}

async function resolveRestaurantByNameCode(
  nameCode: string | undefined | null,
): Promise<string | null> {
  if (!nameCode) return null;
  const [restaurant] = await db
    .select({ id: restaurantsTable.id })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.nameCode, nameCode));
  return restaurant?.id ?? null;
}

async function getUnmappedRestaurant(): Promise<Restaurant> {
  const [restaurant] = await db
    .select()
    .from(restaurantsTable)
    .where(eq(restaurantsTable.nameCode, UNMAPPED_RESTAURANT_NAME_CODE));
  if (!restaurant) {
    throw httpError(
      503,
      "UNMAPPED_RESTAURANT_NOT_SEEDED",
      "Placeholder restaurant for parked orders has not been seeded",
    );
  }
  return restaurant;
}

async function loadOrderOr404(id: string) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id));
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Order not found");
  return order;
}

async function loadOrderForAuthOr404(
  auth: NonNullable<Request["auth"]>,
  id: string,
) {
  const scope = orderScopeWhere(auth);
  const where = scope
    ? and(eq(ordersTable.id, id), scope)
    : eq(ordersTable.id, id);
  const [order] = await db.select().from(ordersTable).where(where);
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Order not found");
  return order;
}

// =====================================================================
// POST /inbound/orders — upstream ingestion
// =====================================================================
router.post(
  "/inbound/orders",
  requireInboundCredential,
  wrap(async (req, res) => {
    const parsed = IngestOrderBody.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    }
    const payload = parsed.data;

    const resolvedRestaurantId = await resolveRestaurantByNameCode(
      payload.restaurantNameCode,
    );
    const isParked = resolvedRestaurantId === null;
    const restaurant = resolvedRestaurantId
      ? await db
          .select()
          .from(restaurantsTable)
          .where(eq(restaurantsTable.id, resolvedRestaurantId))
          .then((rows) => rows[0])
      : await getUnmappedRestaurant();
    if (!restaurant) {
      // resolvedRestaurantId pointed at a restaurant that no longer exists.
      throw httpError(500, "DB_ERROR", "Resolved restaurant not found");
    }
    const parkedReason = isParked
      ? `Unresolved restaurantNameCode: ${payload.restaurantNameCode ?? "(absent)"}`
      : null;

    // pickup_time_original is immutable after insert — computed here and never
    // recomputed on replay. Everything anchors to requestedDeliveryTime, which
    // already carries the restaurant's opening hours and prep time because the
    // source applied them before showing the customer a delivery time.
    // See docs/workflow-decisions.md D13.
    const [pickupOffsetMinutes, pickupWithinMinutes] = await Promise.all([
      readSetting(SETTINGS.pickupOffsetMinutes),
      readSetting(SETTINGS.pickupWithinMinutes),
    ]);
    const { pickupTimeOriginal, basis, minutes, anchor } = resolveOriginalPickupTime({
      deliveryTimeType: payload.deliveryTimeType,
      sourceCreatedAt: payload.sourceCreatedAt,
      requestedDeliveryTime: payload.requestedDeliveryTime,
      pickupOffsetMinutes,
      pickupWithinMinutes,
    });
    const leadMinutes = leadTimeMinutes({
      sourceCreatedAt: payload.sourceCreatedAt,
      requestedDeliveryTime: payload.requestedDeliveryTime,
    });

    const items = payload.items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      price: it.price,
      ...(it.notes != null ? { notes: it.notes } : {}),
      ...(it.totalPrice != null ? { totalPrice: it.totalPrice } : {}),
      ...(it.externalId != null ? { externalId: it.externalId } : {}),
    }));

    // Idempotent on externalOrderId. Use insert-only first to detect race-safe
    // brand-new vs replay; on replay update only mutable fields.
    const inserted = await db
      .insert(ordersTable)
      .values({
        externalOrderId: payload.orderId,
        restaurantId: restaurant.id,
        customerName: payload.customer.name,
        customerPhone: payload.customer.phone,
        customerEmail: payload.customer.email ?? null,
        deliveryAddressOriginal: payload.customer.address,
        street: payload.customer.street,
        houseNumber: payload.customer.houseNumber ?? null,
        addition: payload.customer.addition ?? null,
        postalCode: payload.customer.postalCode,
        city: payload.customer.city,
        country: payload.customer.country,
        latitude: payload.customer.latitude ?? null,
        longitude: payload.customer.longitude ?? null,
        deliveryInstructions: payload.deliveryInstructions ?? null,
        deliveryFee: payload.deliveryFee,
        totalAmount: payload.totalAmount,
        tipRider: payload.tipRider,
        tipRestaurant: payload.tipRestaurant,
        supTotal: payload.supTotal,
        statiegeldTotal: payload.statiegeldTotal,
        administrationCosts: payload.administrationCosts,
        deliveryMethod: payload.deliveryMethod,
        paymentMethod: payload.paymentMethod,
        cashPaymentType: payload.cashPayment?.type ?? null,
        cashPaymentChangeAmount: payload.cashPayment?.changeAmount ?? null,
        cashPaymentChangeRequired: payload.cashPayment?.changeRequired ?? null,
        cashPaymentLabel: payload.cashPayment?.label ?? null,
        kitchenNotes: payload.kitchenNotes ?? null,
        sourceCreatedAt: payload.sourceCreatedAt,
        requestedDeliveryTime: payload.requestedDeliveryTime,
        deliveryTimeType: payload.deliveryTimeType,
        sourceRestaurantReadyTime: payload.sourceRestaurantReadyTime ?? null,
        restaurantMinDeliveryTime: payload.restaurantMinDeliveryTime ?? null,
        restaurantMinPickupTime: payload.restaurantMinPickupTime ?? null,
        restaurantMinPrepTime: payload.restaurantMinPrepTime ?? null,
        deliveryTeamMinDeliveryTime: payload.deliveryTeamMinDeliveryTime ?? null,
        deliveryTeamMinPickupTime: payload.deliveryTeamMinPickupTime ?? null,
        deliveryTeamMinPrepTime: payload.deliveryTeamMinPrepTime ?? null,
        items,
        originalPayload: payload as unknown as Record<string, unknown>,
        pickupTimeOriginal,
        // A parked order is held: it isn't dispatchable until a coordinator
        // resolves which restaurant it belongs to.
        holdState: isParked ? "parked" : null,
        holdReason: parkedReason,
        heldAt: isParked ? new Date() : null,
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
          // deliveryAddressOriginal excluded — immutable like pickupTimeOriginal
          // and sourceCreatedAt (D12). A replay's own address is not lost:
          // originalPayload below is refreshed every time.
          street: payload.customer.street,
          houseNumber: payload.customer.houseNumber ?? null,
          addition: payload.customer.addition ?? null,
          postalCode: payload.customer.postalCode,
          city: payload.customer.city,
          country: payload.customer.country,
          latitude: payload.customer.latitude ?? null,
          longitude: payload.customer.longitude ?? null,
          deliveryInstructions: payload.deliveryInstructions ?? null,
          deliveryFee: payload.deliveryFee,
          totalAmount: payload.totalAmount,
          tipRider: payload.tipRider,
          tipRestaurant: payload.tipRestaurant,
          supTotal: payload.supTotal,
          statiegeldTotal: payload.statiegeldTotal,
          administrationCosts: payload.administrationCosts,
          deliveryMethod: payload.deliveryMethod,
          paymentMethod: payload.paymentMethod,
          cashPaymentType: payload.cashPayment?.type ?? null,
          cashPaymentChangeAmount: payload.cashPayment?.changeAmount ?? null,
          cashPaymentChangeRequired: payload.cashPayment?.changeRequired ?? null,
          cashPaymentLabel: payload.cashPayment?.label ?? null,
          kitchenNotes: payload.kitchenNotes ?? null,
          // sourceCreatedAt excluded — historical fact about the original
          // upstream event, immutable like pickupTimeOriginal.
          requestedDeliveryTime: payload.requestedDeliveryTime,
          deliveryTimeType: payload.deliveryTimeType,
          sourceRestaurantReadyTime: payload.sourceRestaurantReadyTime ?? null,
          restaurantMinDeliveryTime: payload.restaurantMinDeliveryTime ?? null,
          restaurantMinPickupTime: payload.restaurantMinPickupTime ?? null,
          restaurantMinPrepTime: payload.restaurantMinPrepTime ?? null,
          deliveryTeamMinDeliveryTime: payload.deliveryTeamMinDeliveryTime ?? null,
          deliveryTeamMinPickupTime: payload.deliveryTeamMinPickupTime ?? null,
          deliveryTeamMinPrepTime: payload.deliveryTeamMinPrepTime ?? null,
          items,
          originalPayload: payload as unknown as Record<string, unknown>,
        })
        .where(eq(ordersTable.externalOrderId, payload.orderId))
        .returning();
      row = updated[0];
    }
    if (!row) throw httpError(500, "DB_ERROR", "Failed to insert or update order");

    if (isNew) {
      // How the pickup time was derived, so a wrong one can be diagnosed from
      // logs alone rather than by reconstructing the payload.
      req.log.info(
        {
          orderId: row.id,
          externalOrderId: row.externalOrderId,
          deliveryTimeType: payload.deliveryTimeType,
          pickupBasis: basis,
          pickupMinutes: minutes,
          pickupAnchor: anchor,
          leadMinutes,
          sourceCreatedAt: payload.sourceCreatedAt.toISOString(),
          pickupTimeOriginal: pickupTimeOriginal.toISOString(),
        },
        "Computed original pickup time",
      );
      await db.insert(orderStatusLogsTable).values({
        orderId: row.id,
        fromStatus: null,
        toStatus: "pending",
        actorUserId: null,
        actorRole: "system",
        note: "Ingested from upstream",
      });
      const audience = audienceForNewOrder();
      // Fire-and-forget: do not block the inbound response on push/webhook IO.
      const fireAndForget = async () => {
        try {
          await Promise.all([
            sendPushToRoles(audience.roles, {
              title: "Nieuwe bestelling",
              body: `${row!.customerName} — ${restaurant.name}`,
              data: { orderId: row!.id, type: "order.created" },
            }),
            audience.notifyOrderRestaurantStaff
              ? sendPushToRestaurantStaff(row!.restaurantId, {
                  title: "Nieuwe bestelling",
                  body: `${row!.customerName}`,
                  data: { orderId: row!.id, type: "order.created" },
                })
              : Promise.resolve(),
            enqueueOutboundEvent({
              eventType: "order.created",
              orderId: row!.id,
              payload: { externalOrderId: row!.externalOrderId, status: row!.status },
              correlationId: String(req.id),
            }),
          ]);
        } catch (err) {
          req.log.error({ err, orderId: row!.id }, "Inbound side effects failed");
        }
      };
      void fireAndForget();
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

    // Role-based scoping enforced at the SQL level via shared helper.
    const scope = orderScopeWhere(auth);
    if (scope) filters.push(scope);

    if (q) {
      const term = `%${q}%`;
      filters.push(
        or(
          ilike(ordersTable.customerName, term),
          // Search the components joined the way they read, so "Hoofdstraat 12"
          // and "1011 AB Amsterdam" both match despite spanning columns. The
          // source's original line stays searchable too: after a correction an
          // order should still be findable by the address it arrived with.
          ilike(
            sql`concat_ws(' ', ${ordersTable.street}, ${ordersTable.houseNumber}, ${ordersTable.addition}, ${ordersTable.postalCode}, ${ordersTable.city})`,
            term,
          ),
          ilike(ordersTable.deliveryAddressOriginal, term),
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
    const auth = req.auth!;
    await loadOrderForAuthOr404(auth, id);
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

    const order = await loadOrderForAuthOr404(auth, id);
    const toStatus = parsed.data.toStatus as OrderStatus;
    // driver_assigned is reachable only via the atomic /assign endpoint so
    // status and riderId are always set together. Reject it here to prevent
    // inconsistent (driver_assigned, riderId=NULL) states.
    if (toStatus === "driver_assigned") {
      throw httpError(
        422,
        "USE_ASSIGN_ENDPOINT",
        "Use POST /orders/:id/assign to transition to driver_assigned",
      );
    }
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
    // Both roles are made to type a failure reason, but it was written only to
    // orders.failureReason while the status log recorded `note` — leaving the
    // timeline saying an order failed and staying silent on why. Carry it into
    // the log so the audit trail is self-contained. See docs/todo-bugs.md B3.
    const logNote =
      parsed.data.note ??
      (toStatus === "failed" ? (updates.failureReason ?? null) : null);
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
      note: logNote,
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
      correlationId: String(req.id),
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
  requireRole("admin", "coordinator", "rider"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const parsed = AssignOrderBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const { riderId } = parsed.data;

    // Rider self-claim path: a rider may only claim *for themselves*, and only
    // when the operator-controlled `allow_rider_self_claim` flag is on. The DB
    // race below (atomic update guarded by status='pending' + rider IS NULL)
    // remains the real authority on whether a claim succeeds — this gate is
    // only about whether the *attempt* is allowed at all.
    if (auth.role === "rider") {
      if (auth.riderId === null || auth.riderId !== riderId) {
        throw httpError(403, "FORBIDDEN", "Riders can only claim orders for themselves");
      }
      const allowed = await readSetting(SETTINGS.allowRiderSelfClaim);
      if (!allowed) {
        throw httpError(403, "SELF_CLAIM_DISABLED", "Rider self-claim is disabled");
      }
    }

    const [rider] = await db
      .select()
      .from(ridersTable)
      .where(eq(ridersTable.id, riderId));
    if (!rider) throw httpError(404, "RIDER_NOT_FOUND", "Rider not found");

    // Atomic claim: only succeeds if status is still 'pending', no rider yet,
    // and the order is not held. The hold check is part of the same guarded
    // UPDATE rather than a prior read so a hold placed concurrently still wins.
    const updated = await db
      .update(ordersTable)
      .set({ status: "driver_assigned", riderId })
      .where(
        and(
          eq(ordersTable.id, id),
          eq(ordersTable.status, "pending"),
          sql`${ordersTable.riderId} IS NULL`,
          notHeld(),
          riderDeliverable(),
        ),
      )
      .returning();

    if (updated.length === 0) {
      // Distinguish absent / held / already-claimed so the caller gets a
      // reason rather than a bare conflict.
      const [exists] = await db
        .select({
          id: ordersTable.id,
          status: ordersTable.status,
          holdState: ordersTable.holdState,
          deliveryMethod: ordersTable.deliveryMethod,
        })
        .from(ordersTable)
        .where(eq(ordersTable.id, id));
      if (!exists) throw httpError(404, "ORDER_NOT_FOUND", "Order not found");
      if (!isRiderDeliverable(exists.deliveryMethod)) {
        throw httpError(
          422,
          "NOT_RIDER_DELIVERABLE",
          "The customer collects this order themselves",
        );
      }
      const held = exists.holdState;
      if (held) {
        throw httpError(
          409,
          "ORDER_ON_HOLD",
          held === "parked"
            ? "Order is parked — resolve its restaurant before assigning"
            : "Order is on hold",
        );
      }
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
        correlationId: String(req.id),
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

    const order = await loadOrderForAuthOr404(auth, id);

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
      correlationId: String(req.id),
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
    // The address is corrected component by component (D12). `deliveryAddress`
    // is derived on read and `deliveryAddressOriginal` is immutable, so there is
    // exactly one writable copy of where the order goes — which is what stopped
    // the two representations drifting (todo-bugs B5).
    if (parsed.data.street !== undefined) updates.street = parsed.data.street;
    if (parsed.data.houseNumber !== undefined) updates.houseNumber = parsed.data.houseNumber ?? null;
    if (parsed.data.addition !== undefined) updates.addition = parsed.data.addition ?? null;
    if (parsed.data.postalCode !== undefined) updates.postalCode = parsed.data.postalCode;
    if (parsed.data.city !== undefined) updates.city = parsed.data.city;
    if (parsed.data.country !== undefined) updates.country = parsed.data.country;
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

// =====================================================================
// POST /orders/:id/ready — the kitchen reports the food is done
// =====================================================================
router.post(
  "/orders/:id/ready",
  requireAuth,
  requireRole("admin", "coordinator", "restaurant_staff"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;

    const order = await loadOrderOr404(id);
    if (
      auth.role === "restaurant_staff" &&
      auth.restaurantId !== order.restaurantId
    ) {
      throw httpError(403, "FORBIDDEN", "Forbidden");
    }

    // A status, not a pickup time. This deliberately does NOT touch
    // pickupTimeRestaurant: the pickup times are a negotiation between the
    // storefront, restaurant, rider and coordinator, and "the food is done" is
    // not a bid in that negotiation. It used to write there, so pressing the
    // button silently replaced whatever the restaurant had agreed. See D14.
    //
    // Idempotent: the first report stands, so a double-tap doesn't rewrite when
    // the food was actually ready.
    if (!order.restaurantReadyAt) {
      await db
        .update(ordersTable)
        .set({ restaurantReadyAt: new Date(), restaurantReadyByUserId: auth.sub })
        .where(eq(ordersTable.id, id));
    }

    res.json(await serializeOrderDetail(id));
  }),
);

// =====================================================================
// POST /orders/:id/acknowledge — restaurant read receipt
// =====================================================================
router.post(
  "/orders/:id/acknowledge",
  requireAuth,
  requireRole("admin", "coordinator", "restaurant_staff"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const parsed = AcknowledgeOrderBody.safeParse(req.body ?? {});
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);

    const order = await loadOrderOr404(id);
    if (
      auth.role === "restaurant_staff" &&
      auth.restaurantId !== order.restaurantId
    ) {
      throw httpError(403, "FORBIDDEN", "Forbidden");
    }

    // Acknowledging is idempotent: the first acknowledgement stands, so a
    // double-tap doesn't rewrite who confirmed or when.
    const updates: Partial<typeof ordersTable.$inferInsert> = {};
    if (!order.restaurantAcceptedAt) {
      updates.restaurantAcceptedAt = new Date();
      updates.restaurantAcceptedByUserId = auth.sub;
    }

    // `choose_time` mode confirms by picking a pickup time. It writes the same
    // column, at the same priority, and logs the same adjustment as an explicit
    // pickup-time update — acknowledgement adds no second mechanism.
    const chosen = parsed.data.pickupTime ?? null;
    if (chosen) {
      updates.pickupTimeRestaurant = chosen;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(ordersTable).set(updates).where(eq(ordersTable.id, id));
    }

    if (chosen) {
      await db.insert(pickupTimeAdjustmentsTable).values({
        orderId: id,
        source: "restaurant",
        previousValue: order.pickupTimeRestaurant,
        newValue: chosen,
        actorUserId: auth.sub,
        actorRole: auth.role,
        reason: "Chosen at acknowledgement",
      });
      await enqueueOutboundEvent({
        eventType: "order.pickup_time_updated",
        orderId: id,
        payload: { source: "restaurant", pickupTime: chosen.toISOString() },
        correlationId: String(req.id),
      });
    }

    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/hold — place a deliberate hold
// =====================================================================
router.post(
  "/orders/:id/hold",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const parsed = HoldOrderBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);

    const order = await loadOrderOr404(id);
    const existing = order.holdState;
    if (existing === "parked") {
      throw httpError(
        422,
        "ORDER_PARKED",
        "Order is parked — resolve its restaurant rather than holding it",
      );
    }
    if (order.status === "delivered" || order.status === "failed") {
      throw httpError(422, "ORDER_TERMINAL", "Cannot hold a finished order");
    }

    await db
      .update(ordersTable)
      .set({
        holdState: "on_hold",
        holdReason: parsed.data.reason?.trim() || null,
        heldByUserId: auth.sub,
        heldAt: new Date(),
      })
      .where(eq(ordersTable.id, id));

    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/release — lift a hold
// =====================================================================
router.post(
  "/orders/:id/release",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const order = await loadOrderOr404(id);
    const existing = order.holdState;
    if (!existing) throw httpError(422, "ORDER_NOT_HELD", "Order is not on hold");
    if (existing === "parked") {
      throw httpError(
        422,
        "ORDER_PARKED",
        "Assign the correct restaurant to release a parked order",
      );
    }

    await db
      .update(ordersTable)
      .set({ holdState: null, holdReason: null, heldByUserId: null, heldAt: null })
      .where(eq(ordersTable.id, id));

    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

// =====================================================================
// POST /orders/:id/restaurant — re-point a parked order and release it
// =====================================================================
router.post(
  "/orders/:id/restaurant",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const auth = req.auth!;
    const parsed = SetOrderRestaurantBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);

    const order = await loadOrderOr404(id);
    const [restaurant] = await db
      .select()
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, parsed.data.restaurantId));
    if (!restaurant) throw httpError(404, "RESTAURANT_NOT_FOUND", "Restaurant not found");
    if (restaurant.nameCode === UNMAPPED_RESTAURANT_NAME_CODE) {
      throw httpError(
        422,
        "INVALID_RESTAURANT",
        "Cannot re-point an order at the placeholder restaurant",
      );
    }

    // Re-pointing is what resolves a parked order, so it lifts the hold in the
    // same write. A manual hold is left alone — it was placed for a separate
    // reason and should be released deliberately.
    const wasParked = order.holdState === "parked";
    await db
      .update(ordersTable)
      .set({
        restaurantId: restaurant.id,
        ...(wasParked
          ? {
              holdState: null,
              holdReason: null,
              heldByUserId: null,
              heldAt: null,
            }
          : {}),
      })
      .where(eq(ordersTable.id, id));

    await db.insert(orderStatusLogsTable).values({
      orderId: id,
      fromStatus: order.status,
      toStatus: order.status,
      actorUserId: auth.sub,
      actorRole: auth.role,
      note: wasParked
        ? `Parked order resolved to ${restaurant.name}`
        : `Restaurant changed to ${restaurant.name}`,
    });

    const detail = await serializeOrderDetail(id);
    res.json(detail);
  }),
);

export default router;
