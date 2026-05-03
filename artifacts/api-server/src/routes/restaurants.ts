import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/restaurants", requireAuth, (_req, res): void => {
  res.json([]);
});

router.post("/restaurants", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.patch("/restaurants/:id", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.delete("/restaurants/:id", requireAuth, (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

export default router;
