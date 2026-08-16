import { lt } from "drizzle-orm";
import { db, revokedTokensTable } from "@workspace/db";
import { logger } from "./logger";
import { SETTINGS, readSetting, writeSetting } from "./settings-registry";
import { isStale } from "./daily-reset";

const INTERVAL_MS = 5 * 60_000;

/**
 * Clear the in-the-moment pickup estimate once a new operational day starts.
 *
 * Deliberately a *clear*, not an expiry computed on every read: the stored row
 * should say what is actually in effect, so an admin looking at settings never
 * sees a value that silently isn't applying. The cost of that choice is a job
 * that could be missed — so it runs on the existing five-minute loop rather
 * than a 03:00 cron, which makes it self-healing. If the server was down at
 * 03:00, the first tick after it returns clears the value.
 *
 * See docs/workflow-decisions.md D13.
 */
async function clearStaleInTheMomentEstimate(): Promise<void> {
  const [current, setAtRaw] = await Promise.all([
    readSetting(SETTINGS.pickupEstimateInTheMomentMinutes),
    readSetting(SETTINGS.pickupEstimateInTheMomentSetAt),
  ]);
  if (current === null) return;
  const setAt = setAtRaw ? new Date(setAtRaw) : null;
  const valid = setAt !== null && !Number.isNaN(setAt.getTime());
  if (valid && !isStale(setAt, new Date())) return;

  await writeSetting(SETTINGS.pickupEstimateInTheMomentMinutes, null);
  await writeSetting(SETTINGS.pickupEstimateInTheMomentSetAt, null);
  logger.info(
    { clearedValue: current, setAt: setAtRaw },
    "Janitor: cleared yesterday's in-the-moment pickup estimate",
  );
}

/**
 * Periodic background cleanup. Prunes expired entries from `revoked_tokens`
 * and clears the in-the-moment pickup estimate when a new day has started.
 * New periodic cleanups belong here so there is one home for cron-like work.
 *
 * Each task is isolated: one failing must not stop the others running.
 */
async function runOnce(): Promise<void> {
  try {
    await clearStaleInTheMomentEstimate();
  } catch (err) {
    logger.error({ err }, "Janitor: in-the-moment estimate reset failed");
  }
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
