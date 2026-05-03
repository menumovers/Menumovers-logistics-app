import { and, eq, lte } from "drizzle-orm";
import {
  db,
  systemSettingsTable,
  webhookRetryQueueTable,
  SETTING_KEYS,
  type WebhookRetry,
} from "@workspace/db";
import { logger } from "./logger";

const RETRY_DELAYS_MS = [30_000, 120_000, 300_000];
const MAX_ATTEMPTS = 4;

/**
 * Resolve the outbound webhook URL.
 *
 * Precedence (admin-configured wins):
 *   1. system_settings.outbound_webhook_url (the admin Settings UI writes here)
 *   2. process.env.WEBHOOK_URL (boot-time fallback for fresh installs)
 *
 * Rationale: operator configuration is runtime, not env. Inverting precedence
 * (admin > env) means an operator can override a misconfigured env var at
 * runtime without redeploying. The Settings page surfaces which source won so
 * the admin can never wonder whether their UI change took effect.
 */
export async function getOutboundWebhookUrl(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, SETTING_KEYS.OUTBOUND_WEBHOOK_URL));
  if (row?.value) return row.value;
  return process.env["WEBHOOK_URL"] ?? null;
}

export type OutboundEventType =
  | "order.created"
  | "order.assigned"
  | "order.status_changed"
  | "order.pickup_time_updated";

export type OutboundEvent = {
  eventType: OutboundEventType;
  orderId: string;
  payload: Record<string, unknown>;
  /** Optional request id (or other correlation id) threaded through from the originating action. */
  correlationId?: string | null;
};

async function attemptDelivery(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; retryable: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // 10 second timeout via AbortSignal
      signal: AbortSignal.timeout(10_000),
    });
    const ok = res.status >= 200 && res.status < 300;
    const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
    return { ok, status: res.status, retryable };
  } catch (err: unknown) {
    return {
      ok: false,
      status: 0,
      retryable: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Enqueue an outbound event. Always tries the first attempt synchronously and,
 * on failure, persists a retry row. Network/5xx failures are retried with
 * 30s, 2m, 5m delays. 4xx (except 408/429) are not retried.
 */
export async function enqueueOutboundEvent(event: OutboundEvent): Promise<void> {
  const url = await getOutboundWebhookUrl();
  const correlationId = event.correlationId ?? null;
  if (!url) {
    logger.debug({ eventType: event.eventType, correlationId }, "No outbound webhook configured");
    return;
  }
  const body = {
    eventType: event.eventType,
    orderId: event.orderId,
    timestamp: new Date().toISOString(),
    data: event.payload,
  };
  const result = await attemptDelivery(url, body);
  if (result.ok) {
    logger.info(
      { eventType: event.eventType, orderId: event.orderId, correlationId, status: result.status, attempt: 1 },
      "Outbound webhook delivered",
    );
    return;
  }

  if (!result.retryable) {
    logger.warn(
      { status: result.status, eventType: event.eventType, orderId: event.orderId, correlationId },
      "Outbound webhook 4xx; not retrying",
    );
    await db.insert(webhookRetryQueueTable).values({
      orderId: event.orderId,
      eventType: event.eventType,
      targetUrl: url,
      payload: body,
      correlationId,
      attemptCount: 1,
      nextRetryAt: new Date(),
      lastError: result.error ?? null,
      lastStatusCode: result.status,
      status: "abandoned",
    });
    return;
  }

  const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[0]);
  logger.warn(
    {
      eventType: event.eventType,
      orderId: event.orderId,
      correlationId,
      status: result.status,
      error: result.error,
      attempt: 1,
      nextRetryAt: nextRetryAt.toISOString(),
    },
    "Outbound webhook failed; retrying",
  );
  await db.insert(webhookRetryQueueTable).values({
    orderId: event.orderId,
    eventType: event.eventType,
    targetUrl: url,
    payload: body,
    correlationId,
    attemptCount: 1,
    nextRetryAt,
    lastError: result.error ?? null,
    lastStatusCode: result.status,
    status: "pending",
  });
}

async function processOne(row: WebhookRetry): Promise<void> {
  const result = await attemptDelivery(
    row.targetUrl,
    row.payload as Record<string, unknown>,
  );
  const attempt = row.attemptCount + 1;
  const logCtx = {
    id: row.id,
    eventType: row.eventType,
    orderId: row.orderId,
    correlationId: row.correlationId,
    attempt,
  };
  if (result.ok) {
    logger.info({ ...logCtx, status: result.status }, "Webhook retry succeeded");
    await db
      .update(webhookRetryQueueTable)
      .set({
        status: "succeeded",
        attemptCount: attempt,
        lastStatusCode: result.status,
        lastError: null,
      })
      .where(eq(webhookRetryQueueTable.id, row.id));
    return;
  }
  if (!result.retryable || attempt >= MAX_ATTEMPTS) {
    logger.warn(
      { ...logCtx, status: result.status, error: result.error, terminal: true },
      "Webhook retry terminal failure",
    );
    await db
      .update(webhookRetryQueueTable)
      .set({
        status: result.retryable ? "failed" : "abandoned",
        attemptCount: attempt,
        lastStatusCode: result.status,
        lastError: result.error ?? `HTTP ${result.status}`,
      })
      .where(eq(webhookRetryQueueTable.id, row.id));
    return;
  }
  // attempt is 1-based after the initial sync send; queue index = attempt - 1.
  const delayIdx = Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1);
  const delay = RETRY_DELAYS_MS[delayIdx]!;
  const nextRetryAt = new Date(Date.now() + delay);
  logger.warn(
    {
      ...logCtx,
      status: result.status,
      error: result.error,
      nextRetryAt: nextRetryAt.toISOString(),
    },
    "Webhook retry scheduled",
  );
  await db
    .update(webhookRetryQueueTable)
    .set({
      attemptCount: attempt,
      nextRetryAt,
      lastStatusCode: result.status,
      lastError: result.error ?? `HTTP ${result.status}`,
    })
    .where(eq(webhookRetryQueueTable.id, row.id));
}

let running = false;

export async function processRetryQueueOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await db
      .select()
      .from(webhookRetryQueueTable)
      .where(
        and(
          eq(webhookRetryQueueTable.status, "pending"),
          lte(webhookRetryQueueTable.nextRetryAt, new Date()),
        ),
      )
      .limit(50);
    for (const row of due) {
      try {
        await processOne(row);
      } catch (err) {
        logger.error(
          { err, id: row.id, correlationId: row.correlationId },
          "Webhook retry processing failed",
        );
      }
    }
  } finally {
    running = false;
  }
}

export function startRetryLoop(): NodeJS.Timeout {
  const intervalMs = 10_000;
  const handle = setInterval(() => {
    processRetryQueueOnce().catch((err) => {
      logger.error({ err }, "Retry loop error");
    });
  }, intervalMs);
  // Don't keep the process alive just for the loop.
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
