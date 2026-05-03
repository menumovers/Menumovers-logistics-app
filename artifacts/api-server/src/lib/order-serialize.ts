import { and, asc, eq } from "drizzle-orm";
import {
  db,
  itemOverridesTable,
  orderStatusLogsTable,
  ordersTable,
  restaurantsTable,
  ridersTable,
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

function baseOrderFields(order: Order, items: SerializedOrderItem[]) {
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
    createdAt: order.createdAt,
  };
}

async function loadJoins(orderIds: string[]): Promise<{
  restaurantsById: Map<string, { id: string; name: string }>;
  ridersById: Map<string, { id: string; name: string }>;
  overridesByOrder: Map<string, ItemOverride[]>;
}> {
  if (orderIds.length === 0) {
    return {
      restaurantsById: new Map(),
      ridersById: new Map(),
      overridesByOrder: new Map(),
    };
  }
  const [restaurants, riders, overrides] = await Promise.all([
    db.select().from(restaurantsTable),
    db
      .select({
        id: ridersTable.id,
        name: usersTable.name,
      })
      .from(ridersTable)
      .innerJoin(usersTable, eq(usersTable.id, ridersTable.userId)),
    db.select().from(itemOverridesTable).orderBy(asc(itemOverridesTable.createdAt)),
  ]);
  const restaurantsById = new Map(restaurants.map((r) => [r.id, r]));
  const ridersById = new Map(riders.map((r) => [r.id, r]));
  const overridesByOrder = new Map<string, ItemOverride[]>();
  for (const o of overrides) {
    if (!orderIds.includes(o.orderId)) continue;
    const arr = overridesByOrder.get(o.orderId) ?? [];
    arr.push(o);
    overridesByOrder.set(o.orderId, arr);
  }
  return { restaurantsById, ridersById, overridesByOrder };
}

export async function serializeOrderListItem(order: Order) {
  const { restaurantsById, ridersById, overridesByOrder } = await loadJoins([
    order.id,
  ]);
  const overrides = overridesByOrder.get(order.id) ?? [];
  const items = applyItemOverrides(order.items ?? [], overrides);
  const restaurant = restaurantsById.get(order.restaurantId);
  const rider = order.riderId ? ridersById.get(order.riderId) : null;
  return {
    ...baseOrderFields(order, items),
    restaurantName: restaurant?.name,
    riderName: rider?.name ?? null,
  };
}

export async function serializeOrderListItems(orders: Order[]) {
  const ids = orders.map((o) => o.id);
  const { restaurantsById, ridersById, overridesByOrder } = await loadJoins(ids);
  return orders.map((order) => {
    const overrides = overridesByOrder.get(order.id) ?? [];
    const items = applyItemOverrides(order.items ?? [], overrides);
    const restaurant = restaurantsById.get(order.restaurantId);
    const rider = order.riderId ? ridersById.get(order.riderId) : null;
    return {
      ...baseOrderFields(order, items),
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
    loadJoins([orderId]),
  ]);

  const items = applyItemOverrides(order.items ?? [], overrides);
  const restaurant = joinData.restaurantsById.get(order.restaurantId);
  const rider = order.riderId
    ? joinData.ridersById.get(order.riderId)
    : null;

  return {
    ...baseOrderFields(order, items),
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

// Reduce false-positive unused export for downstream consumers.
export const _typesUsed: SerializedOrderItem | null = null;

// Avoid unused import warning if `and` is later needed.
void and;
