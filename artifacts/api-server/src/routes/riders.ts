import { Router, type IRouter } from "express";
import { requireAuth, requireRole } from "../lib/auth";

const router: IRouter = Router();

router.get("/riders", requireAuth, (_req, res): void => {
  res.json([]);
});

router.post("/riders", requireAuth, requireRole("admin", "coordinator"), (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.patch("/riders/:id", requireAuth, requireRole("admin", "coordinator"), (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/riders/me/availability", requireAuth, requireRole("rider"), (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

export default router;
