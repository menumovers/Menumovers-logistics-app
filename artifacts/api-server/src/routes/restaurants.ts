import { Router, type IRouter } from "express";
import { requireAuth, requireRole } from "../lib/auth";

const router: IRouter = Router();

router.get("/restaurants", requireAuth, (_req, res): void => {
  res.json([]);
});

router.post("/restaurants", requireAuth, requireRole("admin", "coordinator"), (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.patch("/restaurants/:id", requireAuth, requireRole("admin", "coordinator"), (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.delete("/restaurants/:id", requireAuth, requireRole("admin"), (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

export default router;
