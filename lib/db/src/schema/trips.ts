import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  serial,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ridersTable } from "./riders";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const TRIP_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "dissolved",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const tripStatusEnum = pgEnum("trip_status", TRIP_STATUSES);

export const TRIP_STOP_KINDS = ["pickup", "dropoff"] as const;
export type TripStopKind = (typeof TRIP_STOP_KINDS)[number];
export const tripStopKindEnum = pgEnum("trip_stop_kind", TRIP_STOP_KINDS);

/**
 * A trip is a coordinator-built bundle of orders that one rider executes
 * together. `tripNumber` is the human-friendly running id surfaced in the UI
 * (Trip #42). `name` is an optional free-text label (e.g. "Siam → Noord").
 *
 * Per-order status remains the source of truth for delivery progress; trips
 * are a layer above that ties orders + stops + a rider together.
 */
export const tripsTable = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripNumber: serial("trip_number").notNull(),
    name: text("name"),
    riderId: uuid("rider_id").references(() => ridersTable.id, {
      onDelete: "set null",
    }),
    status: tripStatusEnum("status").notNull().default("planned"),
    createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    tripNumberIdx: uniqueIndex("trips_trip_number_unique").on(t.tripNumber),
    riderIdx: index("trips_rider_idx").on(t.riderId),
    statusIdx: index("trips_status_idx").on(t.status),
  }),
);

/**
 * Ordered stops in a trip. Each order can contribute up to two stops
 * (pickup + dropoff). `sequence` is the rider's planned execution order.
 *
 * A stop records *what to do and in what order* — nothing about whether it
 * happened. Progress is derived from the order's status instead (D6), so
 * there is no second thing for a rider to keep up to date and no way for the
 * two records to disagree. `completed_at` used to live here and was never
 * written by anything.
 */
export const tripStopsTable = pgTable(
  "trip_stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => tripsTable.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    kind: tripStopKindEnum("kind").notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tripIdx: index("trip_stops_trip_idx").on(t.tripId),
    orderIdx: index("trip_stops_order_idx").on(t.orderId),
    uniqueOrderKindPerTrip: uniqueIndex("trip_stops_trip_order_kind_unique").on(
      t.tripId,
      t.orderId,
      t.kind,
    ),
  }),
);

export const insertTripSchema = createInsertSchema(tripsTable).omit({
  id: true,
  tripNumber: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type Trip = typeof tripsTable.$inferSelect;

export const insertTripStopSchema = createInsertSchema(tripStopsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTripStop = z.infer<typeof insertTripStopSchema>;
export type TripStop = typeof tripStopsTable.$inferSelect;
