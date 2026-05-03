import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/push/vapid-public-key", (_req, res): void => {
  const publicKey = process.env["VAPID_PUBLIC_KEY"] ?? null;
  res.json({ publicKey, configured: Boolean(publicKey) });
});

router.post("/push/subscribe", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/push/unsubscribe", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

export default router;
