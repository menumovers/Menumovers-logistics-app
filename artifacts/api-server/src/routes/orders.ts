import { Router, type IRouter } from "express";
import { requireAuth, requireInboundSecret } from "../lib/auth";

// Stub router. Task #2 implements ingestion, listing, detail, status transitions,
// rider assignment, pickup time updates, item overrides, contact overrides,
// and rider notifications.
const router: IRouter = Router();

router.post("/inbound/orders", requireInboundSecret, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.get("/orders", requireAuth, (_req, res): void => {
  res.json([]);
});

router.get("/orders/:id", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/orders/:id/status", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/orders/:id/assign", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/orders/:id/pickup-time", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/orders/:id/items/hide", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/orders/:id/items/add", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/orders/:id/notification", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/orders/:id/contact", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

export default router;
