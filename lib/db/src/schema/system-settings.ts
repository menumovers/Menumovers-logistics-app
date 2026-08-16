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
   * Our own baseline estimate, in minutes, for how long before delivery a rider
   * should collect. Used for every scheduled order, and as the last fallback
   * for an ASAP order whose payload carried no minimum pickup time.
   */
  PICKUP_ESTIMATE_DEFAULT_MINUTES: "pickup_estimate_default_minutes",
  /**
   * Today's conditions, set by a coordinator in absolute terms ("we need 45
   * minutes today"). ASAP orders only. Cleared each day at 03:00
   * Europe/Amsterdam by the janitor, so a new day starts from the default.
   */
  PICKUP_ESTIMATE_IN_THE_MOMENT_MINUTES: "pickup_estimate_in_the_moment_minutes",
  /**
   * When the in-the-moment value was last written. Not a user-facing setting —
   * the janitor reads it to decide whether the value belongs to a previous day.
   */
  PICKUP_ESTIMATE_IN_THE_MOMENT_SET_AT: "pickup_estimate_in_the_moment_set_at",
} as const;
