import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Operator-managed key/value config. Known keys: "outbound_webhook_url".
export const systemSettingsTable = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertSystemSettingSchema = createInsertSchema(systemSettingsTable).omit({
  updatedAt: true,
});
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;
export type SystemSetting = typeof systemSettingsTable.$inferSelect;

export const SETTING_KEYS = {
  OUTBOUND_WEBHOOK_URL: "outbound_webhook_url",
  ALLOW_RIDER_SELF_CLAIM: "allow_rider_self_claim",
} as const;
