import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { usersTable } from "./users";
import type { UserRole } from "./users";

export const PICKUP_TIME_SOURCES = [
  "rider",
  "restaurant",
  "coordinator_override",
] as const;
export type PickupTimeSource = (typeof PICKUP_TIME_SOURCES)[number];

export const pickupTimeAdjustmentsTable = pgTable(
  "pickup_time_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    source: text("source").notNull().$type<PickupTimeSource>(),
    previousValue: timestamp("previous_value", { withTimezone: true }),
    newValue: timestamp("new_value", { withTimezone: true }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").$type<UserRole | "system" | null>(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index("pickup_time_adjustments_order_idx").on(t.orderId),
  }),
);

export const insertPickupTimeAdjustmentSchema = createInsertSchema(
  pickupTimeAdjustmentsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertPickupTimeAdjustment = z.infer<typeof insertPickupTimeAdjustmentSchema>;
export type PickupTimeAdjustment = typeof pickupTimeAdjustmentsTable.$inferSelect;
