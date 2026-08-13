import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, systemSettingsTable, SETTING_KEYS } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth";
import { httpError } from "../lib/errors";
import { countActiveCredentials } from "../lib/inbound-credentials";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/**
 * Outbound webhook URL precedence (admin-configured wins):
 *   1. system_settings.outbound_webhook_url
 *   2. process.env.WEBHOOK_URL (fallback for fresh installs)
 * Mirrors `getOutboundWebhookUrl` in lib/webhook.ts.
 */
async function readWebhookUrl(): Promise<{
  url: string | null;
  source: "env" | "settings" | "unset";
}> {
  const [row] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, SETTING_KEYS.OUTBOUND_WEBHOOK_URL));
  if (row?.value) return { url: row.value, source: "settings" };
  const fromEnv = process.env["WEBHOOK_URL"];
  if (fromEnv) return { url: fromEnv, source: "env" };
  return { url: null, source: "unset" };
}

async function readAllowRiderSelfClaim(): Promise<boolean> {
  const [row] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, SETTING_KEYS.ALLOW_RIDER_SELF_CLAIM));
  // Default ON: matches the original product spec where riders can claim
  // unassigned orders. Operators flip this OFF to require coordinator dispatch.
  if (!row?.value) return true;
  return row.value === "true";
}

function buildSettings(
  url: string | null,
  source: "env" | "settings" | "unset",
  allowRiderSelfClaim: boolean,
  inboundSecretConfigured: boolean,
) {
  return {
    outboundWebhookUrl: url,
    outboundWebhookUrlSource: source,
    allowRiderSelfClaim,
    vapidConfigured: Boolean(
      process.env["VAPID_PUBLIC_KEY"] && process.env["VAPID_PRIVATE_KEY"],
    ),
    inboundSecretConfigured,
  };
}

// Auth-only (any role) read of operational flags. Riders need to know whether
// self-claim is permitted in order to render the claim button; full /settings
// is admin-only because it includes the outbound webhook URL.
router.get(
  "/settings/flags",
  requireAuth,
  wrap(async (_req, res) => {
    const allowRiderSelfClaim = await readAllowRiderSelfClaim();
    res.json({ allowRiderSelfClaim });
  }),
);

router.get(
  "/settings",
  requireAuth,
  requireRole("admin"),
  wrap(async (_req, res) => {
    const [{ url, source }, allowRiderSelfClaim, activeCredentials] = await Promise.all([
      readWebhookUrl(),
      readAllowRiderSelfClaim(),
      countActiveCredentials(),
    ]);
    res.json(buildSettings(url, source, allowRiderSelfClaim, activeCredentials > 0));
  }),
);

router.patch(
  "/settings",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const parsed = UpdateSettingsBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);

    if (parsed.data.outboundWebhookUrl !== undefined) {
      const value = parsed.data.outboundWebhookUrl;
      if (value === null || value === "") {
        await db
          .delete(systemSettingsTable)
          .where(eq(systemSettingsTable.key, SETTING_KEYS.OUTBOUND_WEBHOOK_URL));
      } else {
        try {
          new URL(value);
        } catch {
          throw httpError(400, "INVALID_URL", "outboundWebhookUrl is not a valid URL");
        }
        await db
          .insert(systemSettingsTable)
          .values({ key: SETTING_KEYS.OUTBOUND_WEBHOOK_URL, value })
          .onConflictDoUpdate({
            target: systemSettingsTable.key,
            set: { value },
          });
      }
    }

    if (parsed.data.allowRiderSelfClaim !== undefined) {
      const value = parsed.data.allowRiderSelfClaim ? "true" : "false";
      await db
        .insert(systemSettingsTable)
        .values({ key: SETTING_KEYS.ALLOW_RIDER_SELF_CLAIM, value })
        .onConflictDoUpdate({
          target: systemSettingsTable.key,
          set: { value },
        });
    }

    const [{ url, source }, allowRiderSelfClaim, activeCredentials] = await Promise.all([
      readWebhookUrl(),
      readAllowRiderSelfClaim(),
      countActiveCredentials(),
    ]);
    res.json(buildSettings(url, source, allowRiderSelfClaim, activeCredentials > 0));
  }),
);

export default router;
