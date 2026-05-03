import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { ridersTable } from "./riders";
import { usersTable } from "./users";

export const ASSIGNMENT_OUTCOMES = ["assigned", "unassigned", "reassigned"] as const;
export type AssignmentOutcome = (typeof ASSIGNMENT_OUTCOMES)[number];

export const riderAssignmentsTable = pgTable(
  "rider_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    riderId: uuid("rider_id").references(() => ridersTable.id, {
      onDelete: "set null",
    }),
    outcome: text("outcome").notNull().$type<AssignmentOutcome>(),
    assignedByUserId: uuid("assigned_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index("rider_assignments_order_idx").on(t.orderId),
    riderIdx: index("rider_assignments_rider_idx").on(t.riderId),
  }),
);

export const insertRiderAssignmentSchema = createInsertSchema(riderAssignmentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRiderAssignment = z.infer<typeof insertRiderAssignmentSchema>;
export type RiderAssignment = typeof riderAssignmentsTable.$inferSelect;
