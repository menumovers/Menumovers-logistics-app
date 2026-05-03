import { Router, type IRouter } from "express";
import { requireAuth, requireRole, sanitizeUser } from "../lib/auth";
import { db, usersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/users", requireAuth, requireRole("admin"), async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable);
  res.json(users.map(sanitizeUser));
});

router.post("/users", requireAuth, requireRole("admin"), (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.patch("/users/:id", requireAuth, requireRole("admin"), (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

router.delete("/users/:id", requireAuth, requireRole("admin"), (_req, res): void => {
  res.status(501).json({ error: "Not implemented" });
});

export default router;
