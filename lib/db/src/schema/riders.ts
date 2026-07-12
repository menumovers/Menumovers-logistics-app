import { pgTable, pgEnum, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const RIDER_AVAILABILITY = ["offline", "online", "backup"] as const;
export type RiderAvailability = (typeof RIDER_AVAILABILITY)[number];

export const riderAvailabilityEnum = pgEnum("rider_availability", RIDER_AVAILABILITY);

export const ridersTable = pgTable(
  "riders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    nameCode: text("name_code").notNull().unique(),
    availabilityStatus: riderAvailabilityEnum("availability_status")
      .notNull()
      .default("offline"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: uniqueIndex("riders_user_unique").on(t.userId),
  }),
);

export const insertRiderSchema = createInsertSchema(ridersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRider = z.infer<typeof insertRiderSchema>;
export type Rider = typeof ridersTable.$inferSelect;
