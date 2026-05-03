import { lt } from "drizzle-orm";
import { db, revokedTokensTable } from "@workspace/db";
import { logger } from "./logger";

const INTERVAL_MS = 5 * 60_000;

/**
 * Periodic background cleanup. Currently prunes expired entries from
 * `revoked_tokens`; new periodic cleanups (e.g. abandoned webhook retry rows
 * older than N days) belong here so there is one home for cron-like work.
 */
async function runOnce(): Promise<void> {
  try {
    const result = await db
      .delete(revokedTokensTable)
      .where(lt(revokedTokensTable.expiresAt, new Date()))
      .returning({ jti: revokedTokensTable.jti });
    if (result.length > 0) {
      logger.info({ removed: result.length }, "Janitor: pruned expired revoked tokens");
    }
  } catch (err) {
    logger.error({ err }, "Janitor: revoked-token cleanup failed");
  }
}

export function startJanitor(): NodeJS.Timeout {
  // Kick once shortly after boot so we don't carry yesterday's expired tokens
  // into the next 5-minute window.
  setTimeout(() => {
    runOnce().catch((err) => logger.error({ err }, "Janitor initial run failed"));
  }, 30_000).unref?.();

  const handle = setInterval(() => {
    runOnce().catch((err) => logger.error({ err }, "Janitor interval failed"));
  }, INTERVAL_MS);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
