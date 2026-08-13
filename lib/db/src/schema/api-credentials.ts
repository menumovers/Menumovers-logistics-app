import { pgTable, pgEnum, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const API_CREDENTIAL_STATUSES = ["active", "revoked"] as const;
export type ApiCredentialStatus = (typeof API_CREDENTIAL_STATUSES)[number];

export const apiCredentialStatusEnum = pgEnum(
  "api_credential_status",
  API_CREDENTIAL_STATUSES,
);

export const apiCredentialsTable = pgTable(
  "api_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // SHA-256 hex digest of the raw secret. The raw secret is never stored.
    keyHash: text("key_hash").notNull(),
    // Identifies the upstream caller this credential belongs to, e.g. "bestellenbij".
    source: text("source").notNull(),
    status: apiCredentialStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyHashIdx: uniqueIndex("api_credentials_key_hash_unique").on(t.keyHash),
  }),
);

export const insertApiCredentialSchema = createInsertSchema(apiCredentialsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertApiCredential = z.infer<typeof insertApiCredentialSchema>;
export type ApiCredential = typeof apiCredentialsTable.$inferSelect;
