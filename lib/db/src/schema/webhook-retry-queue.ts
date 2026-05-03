import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";

export const WEBHOOK_QUEUE_STATUSES = ["pending", "succeeded", "failed", "abandoned"] as const;
export type WebhookQueueStatus = (typeof WEBHOOK_QUEUE_STATUSES)[number];

export const webhookRetryQueueTable = pgTable(
  "webhook_retry_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").references(() => ordersTable.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    targetUrl: text("target_url").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    lastStatusCode: integer("last_status_code"),
    status: text("status").notNull().default("pending").$type<WebhookQueueStatus>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    statusIdx: index("webhook_retry_status_idx").on(t.status, t.nextRetryAt),
  }),
);

export const insertWebhookRetrySchema = createInsertSchema(webhookRetryQueueTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWebhookRetry = z.infer<typeof insertWebhookRetrySchema>;
export type WebhookRetry = typeof webhookRetryQueueTable.$inferSelect;
