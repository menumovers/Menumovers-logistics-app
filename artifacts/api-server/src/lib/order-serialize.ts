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

type Numeric = string;

export type SerializedOrderItem = {
  name: string;
  quantity: number;
  price: Numeric;
  notes?: string | null;
};

function toSerializedItem(item: OrderItem): SerializedOrderItem {
  return {
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    notes: item.notes ?? null,
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
    deliveryAddress: order.deliveryAddress,
    deliveryInstructions: order.deliveryInstructions,
    deliveryFee: order.deliveryFee,
    totalAmount: order.totalAmount,
    items,
    pickupTimeOriginal: order.pickupTimeOriginal,
    pickupTimeRider: order.pickupTimeRider,
    pickupTimeRestaurant: order.pickupTimeRestaurant,
    pickupTimeOverride: order.pickupTimeOverride,
    effectivePickupTime: eff.effectivePickupTime,
    effectivePickupSource: eff.effectivePickupSource,
    pendingRiderNotification: order.pendingRiderNotification,
    failureReason: order.failureReason,
    isParked: order.isParked,
    parkedReason: order.parkedReason,
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
}> {
  const restaurantsById = new Map<string, { id: string; name: string }>();
  const ridersById = new Map<string, { id: string; name: string }>();
  const overridesByOrder = new Map<string, ItemOverride[]>();
  const bundlePickupByOrder = new Map<string, Date>();
  const tripNumbersById = new Map<string, number>();
  if (orders.length === 0) {
    return {
      restaurantsById,
      ridersById,
      overridesByOrder,
      bundlePickupByOrder,
      tripNumbersById,
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

  const [restaurants, riders, overrides, tripMates, tripRows] = await Promise.all([
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
  ]);
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
