import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth";
import { httpError } from "../lib/errors";
import { countActiveCredentials } from "../lib/inbound-credentials";
import {
  SETTINGS,
  readSetting,
  resolveAllSettings,
  writeSetting,
} from "../lib/settings-registry";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/**
 * Assemble the admin Settings payload. Every declared setting is resolved in
 * one query; the remaining fields are derived environment status rather than
 * operator-editable settings, so they stay hand-written here.
 */
async function buildSettings() {
  const [resolved, activeCredentials] = await Promise.all([
    resolveAllSettings(),
    countActiveCredentials(),
  ]);
  return {
    outboundWebhookUrl: resolved.outboundWebhookUrl.value,
    outboundWebhookUrlSource: resolved.outboundWebhookUrl.source,
    outboundWebhookEnabled: resolved.outboundWebhookEnabled.value,
    allowRiderSelfClaim: resolved.allowRiderSelfClaim.value,
    pickupEstimateDefaultMinutes: resolved.pickupEstimateDefaultMinutes.value,
    pickupEstimateInTheMomentMinutes: resolved.pickupEstimateInTheMomentMinutes.value,
    pickupEstimateInTheMomentSetAt: resolved.pickupEstimateInTheMomentSetAt.value,
    vapidConfigured: Boolean(
      process.env["VAPID_PUBLIC_KEY"] && process.env["VAPID_PRIVATE_KEY"],
    ),
    inboundSecretConfigured: activeCredentials > 0,
  };
}

// Auth-only (any role) read of operational flags. Riders need to know whether
// self-claim is permitted in order to render the claim button; full /settings
// is admin-only because it includes the outbound webhook URL.
router.get(
  "/settings/flags",
  requireAuth,
  wrap(async (_req, res) => {
    const allowRiderSelfClaim = await readSetting(SETTINGS.allowRiderSelfClaim);
    res.json({ allowRiderSelfClaim });
  }),
);

router.get(
  "/settings",
  requireAuth,
  requireRole("admin"),
  wrap(async (_req, res) => {
    res.json(await buildSettings());
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
      await writeSetting(SETTINGS.outboundWebhookUrl, parsed.data.outboundWebhookUrl);
    }

    if (parsed.data.outboundWebhookEnabled !== undefined) {
      await writeSetting(SETTINGS.outboundWebhookEnabled, parsed.data.outboundWebhookEnabled);
    }

    if (parsed.data.allowRiderSelfClaim !== undefined) {
      await writeSetting(SETTINGS.allowRiderSelfClaim, parsed.data.allowRiderSelfClaim);
    }

    if (parsed.data.pickupEstimateDefaultMinutes !== undefined) {
      await writeSetting(
        SETTINGS.pickupEstimateDefaultMinutes,
        parsed.data.pickupEstimateDefaultMinutes,
      );
    }

    if (parsed.data.pickupEstimateInTheMomentMinutes !== undefined) {
      const value = parsed.data.pickupEstimateInTheMomentMinutes;
      await writeSetting(SETTINGS.pickupEstimateInTheMomentMinutes, value);
      // Stamped alongside the value so the janitor can tell which operational
      // day it belongs to. Cleared with it, so a null value never leaves a
      // stray timestamp behind.
      await writeSetting(
        SETTINGS.pickupEstimateInTheMomentSetAt,
        value === null ? null : new Date().toISOString(),
      );
    }

    res.json(await buildSettings());
  }),
);

export default router;
