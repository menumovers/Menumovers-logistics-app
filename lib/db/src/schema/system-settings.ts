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
   * How quickly the delivery team can collect right now, in minutes counted
   * **forwards from the order arriving** — "it's quiet, we can be there in
   * ten". A different quantity from PICKUP_OFFSET_MINUTES, which counts
   * backwards from the delivery time; the two never combine.
   *
   * When set it simply is the pickup time for an ASAP order, so a small value
   * moves pickup earlier and a large one later. ASAP only. Cleared each day at
   * 03:00 Europe/Amsterdam by the janitor.
   */
  PICKUP_WITHIN_MINUTES: "pickup_within_minutes",
  /**
   * When PICKUP_WITHIN_MINUTES was last written. Not a user-facing setting —
   * the janitor reads it to decide whether the value belongs to a previous day.
   */
  PICKUP_WITHIN_SET_AT: "pickup_within_set_at",
} as const;
