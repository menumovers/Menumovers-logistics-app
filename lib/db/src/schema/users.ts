import { pgTable, pgEnum, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";

export const USER_ROLES = ["admin", "coordinator", "rider", "restaurant_staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ["active", "suspended"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const userRoleEnum = pgEnum("user_role", USER_ROLES);
export const accountStatusEnum = pgEnum("account_status", ACCOUNT_STATUSES);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    restaurantId: uuid("restaurant_id").references(() => restaurantsTable.id, {
      onDelete: "set null",
    }),
    accountStatus: accountStatusEnum("account_status").notNull().default("active"),
    preferredLocale: text("preferred_locale"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    usernameIdx: uniqueIndex("users_username_unique").on(t.username),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
