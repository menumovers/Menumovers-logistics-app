import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";

export const restaurantExternalIdsTable = pgTable(
  "restaurant_external_ids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurantsTable.id, { onDelete: "cascade" }),
    // Matches api_credentials.source, e.g. "bestellenbij".
    source: text("source").notNull(),
    // The restaurant identifier as known to that source's system.
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceExternalIdIdx: uniqueIndex("restaurant_external_ids_source_external_id_unique").on(
      t.source,
      t.externalId,
    ),
  }),
);

export const insertRestaurantExternalIdSchema = createInsertSchema(
  restaurantExternalIdsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertRestaurantExternalId = z.infer<typeof insertRestaurantExternalIdSchema>;
export type RestaurantExternalId = typeof restaurantExternalIdsTable.$inferSelect;
