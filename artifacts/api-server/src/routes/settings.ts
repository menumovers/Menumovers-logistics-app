import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, systemSettingsTable, SETTING_KEYS } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth";

const router: IRouter = Router();

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

router.get(
  "/settings",
  requireAuth,
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const { url, source } = await readWebhookUrl();
    res.json({
      outboundWebhookUrl: url,
      outboundWebhookUrlSource: source,
      vapidConfigured: Boolean(
        process.env["VAPID_PUBLIC_KEY"] && process.env["VAPID_PRIVATE_KEY"],
      ),
      inboundSecretConfigured: Boolean(process.env["INBOUND_SHARED_SECRET"]),
    });
  },
);

router.patch("/settings", requireAuth, requireRole("admin"), (_req, res): void => {
  // Implemented in Task #2.
  res.status(501).json({ error: "Not implemented" });
});

export default router;
