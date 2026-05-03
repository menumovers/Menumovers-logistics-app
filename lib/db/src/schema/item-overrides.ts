import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { usersTable } from "./users";
import type { OrderItem } from "./orders";

export const ITEM_OVERRIDE_TYPES = ["hide", "add"] as const;
export type ItemOverrideType = (typeof ITEM_OVERRIDE_TYPES)[number];

export const itemOverridesTable = pgTable(
  "item_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull().$type<ItemOverrideType>(),
    // For "hide": index into the original items array.
    itemIndex: integer("item_index"),
    // For "add": the new item payload.
    addedItem: jsonb("added_item").$type<OrderItem | null>(),
    createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index("item_overrides_order_idx").on(t.orderId),
  }),
);

export const insertItemOverrideSchema = createInsertSchema(itemOverridesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertItemOverride = z.infer<typeof insertItemOverrideSchema>;
export type ItemOverride = typeof itemOverridesTable.$inferSelect;
