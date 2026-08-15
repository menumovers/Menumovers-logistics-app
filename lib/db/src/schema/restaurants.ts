import { pgTable, pgEnum, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * How this restaurant is asked to acknowledge an order.
 *
 *   - `accept`      — a single confirm action.
 *   - `choose_time` — confirm by picking one of three pickup times: the one we
 *                     proposed, ten minutes earlier, or ten minutes later.
 *
 * Purely a UX choice. Acknowledgement never gates anything either way — see
 * docs/workflow-decisions.md D3.
 */
export const RESTAURANT_ACCEPTANCE_MODES = ["accept", "choose_time"] as const;
export type RestaurantAcceptanceMode = (typeof RESTAURANT_ACCEPTANCE_MODES)[number];

export const restaurantAcceptanceModeEnum = pgEnum(
  "restaurant_acceptance_mode",
  RESTAURANT_ACCEPTANCE_MODES,
);

export const restaurantsTable = pgTable("restaurants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  nameCode: text("name_code").notNull().unique(),
  address: text("address").notNull(),
  phone: text("phone"),
  // Minimum minutes from order ingestion to expected pickup. Used to compute pickup_time_original.
  minDeliveryTime: integer("min_delivery_time").notNull().default(30),
  acceptanceMode: restaurantAcceptanceModeEnum("acceptance_mode")
    .notNull()
    .default("accept"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertRestaurantSchema = createInsertSchema(restaurantsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRestaurant = z.infer<typeof insertRestaurantSchema>;
export type Restaurant = typeof restaurantsTable.$inferSelect;
