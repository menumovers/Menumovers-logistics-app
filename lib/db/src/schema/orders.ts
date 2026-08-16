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
import { usersTable } from "./users";

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

/**
 * The "on hold" family — the only mechanism that genuinely gates an order.
 * Order status is a *report* of where things stand and never blocks; a hold
 * is a deliberate stop. Kept as its own column rather than as extra
 * `order_status` values so the two axes stay independent: an order can be
 * simultaneously held and last-reported-en-route.
 *
 * NULL means "not held". Members:
 *   - `parked`  — set automatically when an inbound restaurant code doesn't resolve
 *   - `on_hold` — set deliberately by an admin or coordinator
 *
 * See docs/workflow-decisions.md D2.
 */
export const ORDER_HOLD_STATES = ["parked", "on_hold"] as const;
export type OrderHoldState = (typeof ORDER_HOLD_STATES)[number];

export const orderHoldStateEnum = pgEnum("order_hold_state", ORDER_HOLD_STATES);

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
    /**
     * IMMUTABLE after insert. Application layer must never UPDATE this column.
     *
     * The source's own single-line address, kept verbatim so a coordinator can
     * see what actually arrived. It is **not** the working address and nothing
     * operational reads it — the structured components below are what the app
     * edits, queries and renders. The source builds this line *from* those same
     * components (`buildFullAddress()`), so it can never carry anything they
     * lack; what it preserves is their state as received, before any
     * coordinator correction.
     *
     * Same shape as `pickupTimeOriginal`: an original preserved beside a
     * mutable working value. See workflow-decisions D12.
     */
    deliveryAddressOriginal: text("delivery_address_original").notNull(),
    /**
     * The working address. These are what a coordinator corrects and what
     * every screen renders (via a display string built from them), so there is
     * exactly one writable copy of where the order goes.
     */
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
    /**
     * Time data from the source. Meanings confirmed by the owner 2026-08-15 and
     * recorded in workflow-decisions.md §F — do not re-infer them from the
     * field names, which is how several wrong readings got built.
     *
     *   sourceCreatedAt            when checkout completed at the source. The
     *                              anchor every duration below counts from.
     *   requestedDeliveryTime      the customer's checkout selection, parsed to
     *                              a timestamp.
     *   deliveryTimeType           asap | later_today | other_day.
     *   sourceRestaurantReadyTime  when the source calculated the restaurant
     *                              should have the order ready, from that
     *                              restaurant's settings at order time.
     *                              ASAP ORDERS ONLY.
     *
     * The six integers are MINUTES FROM CHECKOUT, in a restaurant and a
     * deliveryTeam variant:
     *
     *   *MinDeliveryTime  checkout → doorstep. The whole journey, prep
     *                     included. NOT travel time.
     *   *MinPickupTime    checkout → pickup at the restaurant.
     *   *MinPrepTime      LEGACY at the source. Ignore.
     */
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
    // Restaurant acknowledgement: "we've seen this order and the pickup time".
    // An acknowledgement, not a gate — nothing waits on it, and the delivery
    // team works the order before and without it. See workflow-decisions D3.
    restaurantAcceptedAt: timestamp("restaurant_accepted_at", { withTimezone: true }),
    restaurantAcceptedByUserId: uuid("restaurant_accepted_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    // The hold family. NULL means the order is not held. A hold blocks *new
    // assignment only* — an order already being worked keeps accepting status
    // reports, so a hold never freezes a rider mid-delivery.
    holdState: orderHoldStateEnum("hold_state"),
    holdReason: text("hold_reason"),
    // Null for automatic holds (`parked`), set for deliberate ones.
    heldByUserId: uuid("held_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    heldAt: timestamp("held_at", { withTimezone: true }),
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
    // Held orders are filtered out of rider discovery on every list query.
    holdIdx: index("orders_hold_state_idx").on(t.holdState),
  }),
);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
