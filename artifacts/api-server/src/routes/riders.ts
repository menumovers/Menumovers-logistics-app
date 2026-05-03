import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/riders", requireAuth, (_req, res): void => {
  res.json([]);
});

router.post("/riders", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.patch("/riders/:id", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/riders/me/availability", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

export default router;
