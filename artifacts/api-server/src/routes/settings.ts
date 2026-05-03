import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, systemSettingsTable, SETTING_KEYS } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth";
import { httpError } from "../lib/errors";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

async function readWebhookUrl(): Promise<{
  url: string | null;
  source: "env" | "settings" | "unset";
}> {
  const fromEnv = process.env["WEBHOOK_URL"];
  if (fromEnv) return { url: fromEnv, source: "env" };
  const [row] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, SETTING_KEYS.OUTBOUND_WEBHOOK_URL));
  if (row?.value) return { url: row.value, source: "settings" };
  return { url: null, source: "unset" };
}

function buildSettings(url: string | null, source: "env" | "settings" | "unset") {
  return {
    outboundWebhookUrl: url,
    outboundWebhookUrlSource: source,
    vapidConfigured: Boolean(
      process.env["VAPID_PUBLIC_KEY"] && process.env["VAPID_PRIVATE_KEY"],
    ),
    inboundSecretConfigured: Boolean(process.env["INBOUND_SHARED_SECRET"]),
  };
}

router.get(
  "/settings",
  requireAuth,
  requireRole("admin"),
  wrap(async (_req, res) => {
    const { url, source } = await readWebhookUrl();
    res.json(buildSettings(url, source));
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
        // Sanity check: must be a valid URL.
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
    const { url, source } = await readWebhookUrl();
    res.json(buildSettings(url, source));
  }),
);

export default router;
