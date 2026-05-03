import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { ridersTable } from "./riders";
import { tripsTable } from "./trips";

export const ORDER_STATUSES = [
  "pending",
  "driver_assigned",
  "en_route_to_restaurant",
  "picked_up",
  "en_route_to_customer",
  "delivered",
  "failed",
  "postponed",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);

export type OrderItem = {
  name: string;
  quantity: number;
  price: string; // string to avoid float math
  notes?: string;
};

export const ordersTable = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Idempotency key from upstream distribution service.
    externalOrderId: text("external_order_id").notNull(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurantsTable.id, { onDelete: "restrict" }),
    riderId: uuid("rider_id").references(() => ridersTable.id, {
      onDelete: "set null",
    }),
    status: orderStatusEnum("status").notNull().default("pending"),
    // Customer info (may be overridden by coordinators; stored here as the live values).
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerEmail: text("customer_email"),
    deliveryAddress: text("delivery_address").notNull(),
    deliveryInstructions: text("delivery_instructions"),
    deliveryFee: numeric("delivery_fee").notNull().default("0"),
    totalAmount: numeric("total_amount").notNull().default("0"),
    // Original immutable items from upstream payload.
    items: jsonb("items").notNull().$type<OrderItem[]>().default([]),
    // The full original upstream payload, kept for forensic / replay use.
    originalPayload: jsonb("original_payload").notNull().$type<Record<string, unknown>>(),
    // IMMUTABLE after insert. Application layer must never UPDATE this column.
    pickupTimeOriginal: timestamp("pickup_time_original", { withTimezone: true }).notNull(),
    pickupTimeRider: timestamp("pickup_time_rider", { withTimezone: true }),
    pickupTimeRestaurant: timestamp("pickup_time_restaurant", { withTimezone: true }),
    pickupTimeOverride: timestamp("pickup_time_override", { withTimezone: true }),
    pendingRiderNotification: text("pending_rider_notification"),
    failureReason: text("failure_reason"),
    // Trip bundling: when set, the order is part of a coordinator-built trip
    // executed alongside other orders by a single rider. Trip is layered
    // above order status — clearing this column does not change `status`.
    tripId: uuid("trip_id").references(() => tripsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    externalIdx: uniqueIndex("orders_external_id_unique").on(t.externalOrderId),
    statusIdx: index("orders_status_idx").on(t.status),
    restaurantIdx: index("orders_restaurant_idx").on(t.restaurantId),
    riderIdx: index("orders_rider_idx").on(t.riderId),
    tripIdx: index("orders_trip_idx").on(t.tripId),
  }),
);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
