import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  boolean,
  integer,
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
  // Line total (price * quantity, as sent raw by the source — not computed
  // here). Optional because items added later via the admin add-item flow
  // don't carry one.
  totalPrice?: string;
  // POS/kitchen article id, when the source provides one.
  externalId?: string;
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
    // Structured address components, sent alongside deliveryAddress rather
    // than replacing it — deliveryAddress stays the single display string
    // for anything still reading it directly. Whether to eventually drop it
    // is an open decision, not acted on here.
    street: text("street").notNull(),
    houseNumber: text("house_number"),
    addition: text("addition"),
    postalCode: text("postal_code").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull(),
    latitude: numeric("latitude"),
    longitude: numeric("longitude"),
    deliveryInstructions: text("delivery_instructions"),
    deliveryFee: numeric("delivery_fee").notNull().default("0"),
    totalAmount: numeric("total_amount").notNull().default("0"),
    // Raw captures from the source — no computation logic, stored as-sent.
    tipRider: text("tip_rider").notNull(),
    tipRestaurant: text("tip_restaurant").notNull(),
    supTotal: text("sup_total").notNull(),
    statiegeldTotal: text("statiegeld_total").notNull(),
    administrationCosts: text("administration_costs").notNull(),
    deliveryMethod: text("delivery_method").notNull(),
    paymentMethod: text("payment_method").notNull(),
    cashPaymentType: text("cash_payment_type"),
    cashPaymentChangeAmount: text("cash_payment_change_amount"),
    cashPaymentChangeRequired: text("cash_payment_change_required"),
    cashPaymentLabel: text("cash_payment_label"),
    kitchenNotes: text("kitchen_notes"),
    // Original immutable items from upstream payload.
    items: jsonb("items").notNull().$type<OrderItem[]>().default([]),
    // The full original upstream payload, kept for forensic / replay use.
    originalPayload: jsonb("original_payload").notNull().$type<Record<string, unknown>>(),
    // IMMUTABLE after insert. Application layer must never UPDATE this column.
    pickupTimeOriginal: timestamp("pickup_time_original", { withTimezone: true }).notNull(),
    pickupTimeRider: timestamp("pickup_time_rider", { withTimezone: true }),
    pickupTimeRestaurant: timestamp("pickup_time_restaurant", { withTimezone: true }),
    pickupTimeOverride: timestamp("pickup_time_override", { withTimezone: true }),
    // Raw time data from the source. Landed for storage only — pickupTimeOriginal's
    // computation still reads only restaurant.minDeliveryTime; wiring these in is a
    // separate, still-open decision (exact formula not decided yet).
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }).notNull(),
    requestedDeliveryTime: timestamp("requested_delivery_time", { withTimezone: true }).notNull(),
    deliveryTimeType: text("delivery_time_type").notNull(),
    sourceRestaurantReadyTime: timestamp("source_restaurant_ready_time", { withTimezone: true }),
    restaurantMinDeliveryTime: integer("restaurant_min_delivery_time"),
    restaurantMinPickupTime: integer("restaurant_min_pickup_time"),
    restaurantMinPrepTime: integer("restaurant_min_prep_time"),
    deliveryTeamMinDeliveryTime: integer("delivery_team_min_delivery_time"),
    deliveryTeamMinPickupTime: integer("delivery_team_min_pickup_time"),
    deliveryTeamMinPrepTime: integer("delivery_team_min_prep_time"),
    pendingRiderNotification: text("pending_rider_notification"),
    failureReason: text("failure_reason"),
    // Set when the inbound restaurantNameCode couldn't be resolved to a known
    // restaurant; the order is filed against a placeholder restaurant instead
    // of being rejected. Not a dispatch-blocking status — just a queryable
    // marker for manual follow-up.
    isParked: boolean("is_parked").notNull().default(false),
    parkedReason: text("parked_reason"),
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
