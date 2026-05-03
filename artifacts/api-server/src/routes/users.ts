import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { CreateUserBody, UpdateUserBody, UpdateMyLocaleBody } from "@workspace/api-zod";
import {
  hashPassword,
  requireAuth,
  requireRole,
  sanitizeUser,
} from "../lib/auth";
import { httpError } from "../lib/errors";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

// PATCH /users/me/locale — any authenticated user can set their own locale.
// Defined BEFORE /users/:id so the literal "me" doesn't get parsed as a uuid id.
router.patch(
  "/users/me/locale",
  requireAuth,
  wrap(async (req, res) => {
    const parsed = UpdateMyLocaleBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const userId = req.auth!.sub;
    const next = parsed.data.preferredLocale; // "nl" | "en" | null
    const [row] = await db
      .update(usersTable)
      .set({ preferredLocale: next })
      .where(eq(usersTable.id, userId))
      .returning();
    if (!row) throw httpError(404, "USER_NOT_FOUND", "User not found");
    res.json({ preferredLocale: next });
  }),
);

router.get(
  "/users",
  requireAuth,
  requireRole("admin"),
  wrap(async (_req, res) => {
    const users = await db.select().from(usersTable);
    res.json(users.map(sanitizeUser));
  }),
);

router.post(
  "/users",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const parsed = CreateUserBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const { email, name, password, role, restaurantId } = parsed.data;
    const passwordHash = await hashPassword(password);
    const [row] = await db
      .insert(usersTable)
      .values({
        email: email.toLowerCase(),
        name,
        passwordHash,
        role,
        restaurantId: restaurantId ?? null,
      })
      .returning();
    if (!row) throw httpError(500, "DB_ERROR", "Failed to create user");
    res.status(201).json(sanitizeUser(row));
  }),
);

router.patch(
  "/users/:id",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (parsed.data.email !== undefined) updates.email = parsed.data.email.toLowerCase();
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.role !== undefined) updates.role = parsed.data.role;
    if (parsed.data.accountStatus !== undefined) updates.accountStatus = parsed.data.accountStatus;
    if (parsed.data.restaurantId !== undefined) updates.restaurantId = parsed.data.restaurantId ?? null;
    if (parsed.data.password !== undefined) {
      updates.passwordHash = await hashPassword(parsed.data.password);
    }

    if (Object.keys(updates).length === 0) {
      const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
      if (!existing) throw httpError(404, "USER_NOT_FOUND", "User not found");
      res.json(sanitizeUser(existing));
      return;
    }

    const [row] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, id))
      .returning();
    if (!row) throw httpError(404, "USER_NOT_FOUND", "User not found");
    res.json(sanitizeUser(row));
  }),
);

router.delete(
  "/users/:id",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    if (req.auth?.sub === id) {
      throw httpError(400, "CANNOT_DELETE_SELF", "Cannot delete your own account");
    }
    const result = await db
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id });
    if (result.length === 0) throw httpError(404, "USER_NOT_FOUND", "User not found");
    res.sendStatus(204);
  }),
);

export default router;
