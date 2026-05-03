import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const revokedTokensTable = pgTable(
  "revoked_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jti: text("jti").notNull(),
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jtiIdx: uniqueIndex("revoked_tokens_jti_unique").on(t.jti),
    expiresIdx: index("revoked_tokens_expires_idx").on(t.expiresAt),
  }),
);

export const insertRevokedTokenSchema = createInsertSchema(revokedTokensTable).omit({
  id: true,
  revokedAt: true,
});
export type InsertRevokedToken = z.infer<typeof insertRevokedTokenSchema>;
export type RevokedToken = typeof revokedTokensTable.$inferSelect;
