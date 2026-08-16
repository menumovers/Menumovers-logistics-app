import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  itemOverridesTable,
  orderStatusLogsTable,
  ordersTable,
  restaurantsTable,
  ridersTable,
  tripsTable,
  usersTable,
  type ItemOverride,
  type Order,
  type OrderItem,
  type OrderStatusLog,
} from "@workspace/db";
import { resolveEffectivePickupTime } from "./pickup-time";
import { nextStatusesFor } from "./state-machine";
import { formatAddress } from "./address";

type Numeric = string;

export type SerializedOrderItem = {
  name: string;
  quantity: number;
  price: Numeric;
  notes?: string | null;
  totalPrice?: Numeric | null;
  externalId?: string | null;
};

function toSerializedItem(item: OrderItem): SerializedOrderItem {
  return {
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    notes: item.notes ?? null,
    totalPrice: item.totalPrice ?? null,
    externalId: item.externalId ?? null,
  };
}

export function applyItemOverrides(
  original: OrderItem[],
  overrides: ItemOverride[],
): SerializedOrderItem[] {
  const hidden = new Set<number>();
  const added: OrderItem[] = [];
  for (const o of overrides) {
    if (o.type === "hide" && typeof o.itemIndex === "number") {
      hidden.add(o.itemIndex);
    } else if (o.type === "add" && o.addedItem) {
      added.push(o.addedItem);
    }
  }
  const visible = original
    .map((item, idx) => (hidden.has(idx) ? null : item))
    .filter((x): x is OrderItem => x !== null);
  return [...visible, ...added].map(toSerializedItem);
}

/**
 * Money arrives as strings to avoid float math, so sums are done in cents.
 */
function moneyToCents(value: string | null | undefined): number | null {
  if (value == null) return null;
  const cleaned = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole = "0", frac = ""] = cleaned.replace("-", "").split(".");
  const cents =
    Number.parseInt(whole, 10) * 100 + Number.parseInt(frac.padEnd(2, "0") || "0", 10);
  return negative ? -cents : cents;
}

function centsToMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A line's value: the source's own line total when present, else price × quantity. */
function lineCents(item: { price: string; quantity: number; totalPrice?: string | null }): number {
  const explicit = moneyToCents(item.totalPrice ?? null);
  if (explicit !== null) return explicit;
  const unit = moneyToCents(item.price);
  return unit === null ? 0 : unit * item.quantity;
}

/**
 * What the delivered items are worth, minus what the ordered items were worth.
 * Null when nothing was overridden.
 *
 * `totalAmount` is written once at ingestion and never recomputed, so once a
 * coordinator hides or adds an item the delivered list stops matching the
 * charged total. The receipt shows this difference explicitly rather than
 * silently presenting a breakdown that doesn't add up — we are not the payment
 * authority, so the charged amount stands and the discrepancy is surfaced.
 */
function itemsAdjustmentOf(
  original: OrderItem[],
  delivered: SerializedOrderItem[],
  hasOverrides: boolean,
): string | null {
  if (!hasOverrides) return null;
  const before = original.reduce((sum, i) => sum + lineCents(i), 0);
  const after = delivered.reduce((sum, i) => sum + lineCents(i), 0);
  return centsToMoney(after - before);
}

function effectiveOf(order: Order): Date {
  return resolveEffectivePickupTime({
    pickupTimeOriginal: order.pickupTimeOriginal,
    pickupTimeRider: order.pickupTimeRider,
    pickupTimeRestaurant: order.pickupTimeRestaurant,
    pickupTimeOverride: order.pickupTimeOverride,
  }).effectivePickupTime;
}

function baseOrderFields(
  order: Order,
  items: SerializedOrderItem[],
  bundlePickupTime: Date | null,
  tripNumber: number | null,
  heldByUserName: string | null,
  restaurantAcceptedByName: string | null,
  itemsAdjustment: string | null,
) {
  const eff = resolveEffectivePickupTime({
    pickupTimeOriginal: order.pickupTimeOriginal,
    pickupTimeRider: order.pickupTimeRider,
    pickupTimeRestaurant: order.pickupTimeRestaurant,
    pickupTimeOverride: order.pickupTimeOverride,
  });
  return {
    id: order.id,
    externalOrderId: order.externalOrderId,
    restaurantId: order.restaurantId,
    riderId: order.riderId,
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    // Built from the components on every read, never stored (D12). Screens keep
    // reading `deliveryAddress` and keep showing one line; what changed is that
    // the line now reflects corrections, because the components are the only
    // writable copy. `deliveryAddressOriginal` is what the source sent.
    deliveryAddress: formatAddress(order),
    deliveryAddressOriginal: order.deliveryAddressOriginal,
    street: order.street,
    houseNumber: order.houseNumber,
    addition: order.addition,
    postalCode: order.postalCode,
    city: order.city,
    country: order.country,
    latitude: order.latitude,
    longitude: order.longitude,
    deliveryInstructions: order.deliveryInstructions,
    deliveryFee: order.deliveryFee,
    totalAmount: order.totalAmount,
    tipRider: order.tipRider,
    tipRestaurant: order.tipRestaurant,
    supTotal: order.supTotal,
    statiegeldTotal: order.statiegeldTotal,
    administrationCosts: order.administrationCosts,
    deliveryMethod: order.deliveryMethod,
    paymentMethod: order.paymentMethod,
    // Emit the object when ANY of the four fields carries a value. Tested
    // explicitly rather than via `a ?? b ?? c ?? d`: `??` binds tighter than
    // `?:`, so an empty-string type used to end the chain with a falsy value
    // and discard a set changeAmount or label. See docs/todo-bugs.md B2.
    cashPayment: [
      order.cashPaymentType,
      order.cashPaymentChangeAmount,
      order.cashPaymentChangeRequired,
      order.cashPaymentLabel,
    ].some((v) => v != null && v !== "")
      ? {
          type: order.cashPaymentType,
          changeAmount: order.cashPaymentChangeAmount,
          changeRequired: order.cashPaymentChangeRequired,
          label: order.cashPaymentLabel,
        }
      : null,
    kitchenNotes: order.kitchenNotes,
    items,
    pickupTimeOriginal: order.pickupTimeOriginal,
    pickupTimeRider: order.pickupTimeRider,
    pickupTimeRestaurant: order.pickupTimeRestaurant,
    pickupTimeOverride: order.pickupTimeOverride,
    sourceCreatedAt: order.sourceCreatedAt,
    requestedDeliveryTime: order.requestedDeliveryTime,
    deliveryTimeType: order.deliveryTimeType,
    sourceRestaurantReadyTime: order.sourceRestaurantReadyTime,
    restaurantMinDeliveryTime: order.restaurantMinDeliveryTime,
    restaurantMinPickupTime: order.restaurantMinPickupTime,
    restaurantMinPrepTime: order.restaurantMinPrepTime,
    deliveryTeamMinDeliveryTime: order.deliveryTeamMinDeliveryTime,
    deliveryTeamMinPickupTime: order.deliveryTeamMinPickupTime,
    deliveryTeamMinPrepTime: order.deliveryTeamMinPrepTime,
    effectivePickupTime: eff.effectivePickupTime,
    effectivePickupSource: eff.effectivePickupSource,
    pendingRiderNotification: order.pendingRiderNotification,
    failureReason: order.failureReason,
    // Derived from the state machine, so the UI renders the options the server
    // will actually accept rather than a hand-maintained copy. See B6.
    allowedTransitions: nextStatusesFor(order.status),
    itemsAdjustment,
    restaurantAcceptedAt: order.restaurantAcceptedAt,
    restaurantReadyAt: order.restaurantReadyAt,
    restaurantAcceptedByName,
    holdState: order.holdState,
    holdReason: order.holdReason,
    heldAt: order.heldAt,
    heldByUserName,
    tripId: order.tripId,
    tripNumber,
    bundlePickupTime,
    createdAt: order.createdAt,
  };
}

async function loadJoins(
  orders: Order[],
): Promise<{
  restaurantsById: Map<string, { id: string; name: string }>;
  ridersById: Map<string, { id: string; name: string }>;
  overridesByOrder: Map<string, ItemOverride[]>;
  /**
   * Earliest effective pickup time across same-(tripId, restaurantId)
   * orders, when more than one exists. Keyed by orderId. Computed across
   * the trip — even orders not in the current `orders` set are considered.
   */
  bundlePickupByOrder: Map<string, Date>;
  tripNumbersById: Map<string, number>;
  /**
   * Display names for user-valued order columns (hold actor, acknowledging
   * restaurant staff), keyed by user id. One lookup covers both.
   */
  holdActorsById: Map<string, string>;
}> {
  const restaurantsById = new Map<string, { id: string; name: string }>();
  const ridersById = new Map<string, { id: string; name: string }>();
  const overridesByOrder = new Map<string, ItemOverride[]>();
  const bundlePickupByOrder = new Map<string, Date>();
  const tripNumbersById = new Map<string, number>();
  const holdActorsById = new Map<string, string>();
  if (orders.length === 0) {
    return {
      restaurantsById,
      ridersById,
      overridesByOrder,
      bundlePickupByOrder,
      tripNumbersById,
      holdActorsById,
    };
  }
  const orderIds = orders.map((o) => o.id);
  const restaurantIds = Array.from(new Set(orders.map((o) => o.restaurantId)));
  const riderIds = Array.from(
    new Set(
      orders
        .map((o) => o.riderId)
        .filter((x): x is string => typeof x === "string"),
    ),
  );
  const tripIds = Array.from(
    new Set(
      orders
        .map((o) => o.tripId)
        .filter((x): x is string => typeof x === "string"),
    ),
  );
  const holdActorIds = Array.from(
    new Set(
      orders
        .flatMap((o) => [o.heldByUserId, o.restaurantAcceptedByUserId])
        .filter((x): x is string => typeof x === "string"),
    ),
  );

  const [restaurants, riders, overrides, tripMates, tripRows, holdActors] = await Promise.all([
    restaurantIds.length > 0
      ? db
          .select({ id: restaurantsTable.id, name: restaurantsTable.name })
          .from(restaurantsTable)
          .where(inArray(restaurantsTable.id, restaurantIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    riderIds.length > 0
      ? db
          .select({ id: ridersTable.id, name: usersTable.name })
          .from(ridersTable)
          .innerJoin(usersTable, eq(usersTable.id, ridersTable.userId))
          .where(inArray(ridersTable.id, riderIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    db
      .select()
      .from(itemOverridesTable)
      .where(inArray(itemOverridesTable.orderId, orderIds))
      .orderBy(asc(itemOverridesTable.createdAt)),
    tripIds.length > 0
      ? db.select().from(ordersTable).where(inArray(ordersTable.tripId, tripIds))
      : Promise.resolve([] as Order[]),
    tripIds.length > 0
      ? db
          .select({ id: tripsTable.id, tripNumber: tripsTable.tripNumber })
          .from(tripsTable)
          .where(inArray(tripsTable.id, tripIds))
      : Promise.resolve([] as { id: string; tripNumber: number }[]),
    holdActorIds.length > 0
      ? db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, holdActorIds))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  for (const u of holdActors) holdActorsById.set(u.id, u.name);
  for (const t of tripRows) tripNumbersById.set(t.id, t.tripNumber);
  for (const r of restaurants) restaurantsById.set(r.id, r);
  for (const r of riders) ridersById.set(r.id, r);
  for (const o of overrides) {
    const arr = overridesByOrder.get(o.orderId) ?? [];
    arr.push(o);
    overridesByOrder.set(o.orderId, arr);
  }
  // Group trip-mate orders by (tripId, restaurantId), then per order set the
  // earliest effective pickup time when the group has more than one order.
  const groupKey = (tripId: string, restaurantId: string) =>
    `${tripId}::${restaurantId}`;
  const groupMembers = new Map<string, Order[]>();
  for (const o of tripMates) {
    if (!o.tripId) continue;
    const key = groupKey(o.tripId, o.restaurantId);
    const arr = groupMembers.get(key) ?? [];
    arr.push(o);
    groupMembers.set(key, arr);
  }
  for (const [, members] of groupMembers) {
    if (members.length < 2) continue;
    const earliest = members
      .map((m) => effectiveOf(m).getTime())
      .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
    const bundle = new Date(earliest);
    for (const m of members) bundlePickupByOrder.set(m.id, bundle);
  }
  return {
    restaurantsById,
    ridersById,
    overridesByOrder,
    bundlePickupByOrder,
    tripNumbersById,
    holdActorsById,
  };
}

export type SerializedOrderListItem = Awaited<
  ReturnType<typeof serializeOrderListItem>
>;

export async function serializeOrderListItem(order: Order) {
  const {
    restaurantsById,
    ridersById,
    overridesByOrder,
    bundlePickupByOrder,
    tripNumbersById,
    holdActorsById,
  } = await loadJoins([order]);
  const overrides = overridesByOrder.get(order.id) ?? [];
  const items = applyItemOverrides(order.items ?? [], overrides);
  const restaurant = restaurantsById.get(order.restaurantId);
  const rider = order.riderId ? ridersById.get(order.riderId) : null;
  return {
    ...baseOrderFields(
      order,
      items,
      bundlePickupByOrder.get(order.id) ?? null,
      order.tripId ? (tripNumbersById.get(order.tripId) ?? null) : null,
      order.heldByUserId ? (holdActorsById.get(order.heldByUserId) ?? null) : null,
      order.restaurantAcceptedByUserId
        ? (holdActorsById.get(order.restaurantAcceptedByUserId) ?? null)
        : null,
      itemsAdjustmentOf(order.items ?? [], items, overrides.length > 0),
    ),
    restaurantName: restaurant?.name,
    riderName: rider?.name ?? null,
  };
}

export async function serializeOrderListItems(orders: Order[]) {
  const {
    restaurantsById,
    ridersById,
    overridesByOrder,
    bundlePickupByOrder,
    tripNumbersById,
    holdActorsById,
  } = await loadJoins(orders);
  return orders.map((order) => {
    const overrides = overridesByOrder.get(order.id) ?? [];
    const items = applyItemOverrides(order.items ?? [], overrides);
    const restaurant = restaurantsById.get(order.restaurantId);
    const rider = order.riderId ? ridersById.get(order.riderId) : null;
    return {
      ...baseOrderFields(
        order,
        items,
        bundlePickupByOrder.get(order.id) ?? null,
        order.tripId ? (tripNumbersById.get(order.tripId) ?? null) : null,
        order.heldByUserId ? (holdActorsById.get(order.heldByUserId) ?? null) : null,
        order.restaurantAcceptedByUserId
          ? (holdActorsById.get(order.restaurantAcceptedByUserId) ?? null)
          : null,
        itemsAdjustmentOf(order.items ?? [], items, overrides.length > 0),
      ),
      restaurantName: restaurant?.name,
      riderName: rider?.name ?? null,
    };
  });
}

export async function serializeOrderDetail(orderId: string) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  if (!order) return null;

  const [statusLogRows, overrides, joinData] = await Promise.all([
    db
      .select({
        log: orderStatusLogsTable,
        actorName: usersTable.name,
      })
      .from(orderStatusLogsTable)
      .leftJoin(usersTable, eq(usersTable.id, orderStatusLogsTable.actorUserId))
      .where(eq(orderStatusLogsTable.orderId, orderId))
      .orderBy(asc(orderStatusLogsTable.createdAt)),
    db
      .select()
      .from(itemOverridesTable)
      .where(eq(itemOverridesTable.orderId, orderId))
      .orderBy(asc(itemOverridesTable.createdAt)),
    loadJoins([order]),
  ]);

  const items = applyItemOverrides(order.items ?? [], overrides);
  const restaurant = joinData.restaurantsById.get(order.restaurantId);
  const rider = order.riderId
    ? joinData.ridersById.get(order.riderId)
    : null;

  return {
    ...baseOrderFields(
      order,
      items,
      joinData.bundlePickupByOrder.get(order.id) ?? null,
      order.tripId
        ? (joinData.tripNumbersById.get(order.tripId) ?? null)
        : null,
      order.heldByUserId
        ? (joinData.holdActorsById.get(order.heldByUserId) ?? null)
        : null,
      order.restaurantAcceptedByUserId
        ? (joinData.holdActorsById.get(order.restaurantAcceptedByUserId) ?? null)
        : null,
      itemsAdjustmentOf(order.items ?? [], items, overrides.length > 0),
    ),
    restaurantName: restaurant?.name,
    riderName: rider?.name ?? null,
    statusLog: statusLogRows.map(({ log, actorName }) => ({
      id: log.id,
      fromStatus: log.fromStatus ?? null,
      toStatus: log.toStatus,
      actorUserId: log.actorUserId,
      actorUserName: actorName ?? null,
      actorRole: log.actorRole ?? null,
      note: log.note ?? null,
      createdAt: log.createdAt,
    })),
    itemOverrides: overrides.map((o: ItemOverride) => ({
      id: o.id,
      type: o.type,
      itemIndex: o.itemIndex,
      addedItem: o.addedItem
        ? {
            name: o.addedItem.name,
            quantity: o.addedItem.quantity,
            price: o.addedItem.price,
            notes: o.addedItem.notes ?? null,
          }
        : null,
      createdAt: o.createdAt,
    })),
  };
}

export type StatusLogEntry = OrderStatusLog & { actorName?: string | null };
