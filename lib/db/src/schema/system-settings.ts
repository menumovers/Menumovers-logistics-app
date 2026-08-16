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
  OUTBOUND_WEBHOOK_ENABLED: "outbound_webhook_enabled",
  ALLOW_RIDER_SELF_CLAIM: "allow_rider_self_claim",
  /**
   * The standing gap, in minutes, between an order's pickup time and the
   * delivery time the customer was shown. Not travel time — nothing measures
   * the journey; this is a chosen offset.
   */
  PICKUP_OFFSET_MINUTES: "pickup_offset_minutes",
   /**
   * The minimum time, in minutes from checkout, that the delivery team needs
   * before it can collect at all today. A constraint rather than a target: it
   * can only push a pickup later, never earlier. ASAP orders only. Cleared
   * each day at 03:00 Europe/Amsterdam by the janitor.
   */
  PICKUP_MINIMUM_TODAY_MINUTES: "pickup_minimum_today_minutes",
  /**
   * When today's minimum was last written. Not a user-facing setting — the
   * janitor reads it to decide whether the value belongs to a previous day.
   */
  PICKUP_MINIMUM_TODAY_SET_AT: "pickup_minimum_today_set_at",
} as const;
