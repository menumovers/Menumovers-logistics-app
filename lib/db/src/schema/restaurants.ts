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
  /**
   * DORMANT BY DESIGN — read by no code since D13. Kept deliberately: it
   * arrives empty from an import, and we may want to set and use it ourselves
   * later. Do not drop it (D11).
   *
   * **Settle what it means before activating it.** Three things currently
   * disagree about this one number:
   *   - the column is called `min_delivery_time`
   *   - both UI labels, Dutch and English, say *prep time* / *bereidingstijd*
   *   - this comment used to claim "minutes from order ingestion to expected
   *     pickup", which is a third thing again, and also claimed it fed
   *     `pickup_time_original` — it did until D13, and no longer does
   *
   * Whoever switches it on inherits whichever of those they happen to read, so
   * pick one, then fix the other two. Tracked as `docs/todo.md` L9.
   */
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
