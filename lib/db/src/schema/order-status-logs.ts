import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { usersTable } from "./users";
import type { OrderStatus } from "./orders";
import type { UserRole } from "./users";

export const orderStatusLogsTable = pgTable(
  "order_status_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<OrderStatus | null>(),
    toStatus: text("to_status").notNull().$type<OrderStatus>(),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").$type<UserRole | "system" | null>(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index("order_status_logs_order_idx").on(t.orderId),
  }),
);

export const insertOrderStatusLogSchema = createInsertSchema(orderStatusLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOrderStatusLog = z.infer<typeof insertOrderStatusLogSchema>;
export type OrderStatusLog = typeof orderStatusLogsTable.$inferSelect;
