import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, restaurantsTable } from "@workspace/db";
import {
  CreateRestaurantBody,
  UpdateRestaurantBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth";
import { httpError } from "../lib/errors";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

router.get(
  "/restaurants",
  requireAuth,
  wrap(async (_req, res) => {
    const rows = await db.select().from(restaurantsTable);
    res.json(rows);
  }),
);

router.post(
  "/restaurants",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const parsed = CreateRestaurantBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const [row] = await db
      .insert(restaurantsTable)
      .values({
        name: parsed.data.name,
        address: parsed.data.address,
        phone: parsed.data.phone ?? null,
        minDeliveryTime: parsed.data.minDeliveryTime,
      })
      .returning();
    res.status(201).json(row);
  }),
);

router.patch(
  "/restaurants/:id",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = UpdateRestaurantBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const updates: Partial<typeof restaurantsTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.address !== undefined) updates.address = parsed.data.address;
    if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone ?? null;
    if (parsed.data.minDeliveryTime !== undefined) updates.minDeliveryTime = parsed.data.minDeliveryTime;
    if (Object.keys(updates).length === 0) {
      const [existing] = await db
        .select()
        .from(restaurantsTable)
        .where(eq(restaurantsTable.id, id));
      if (!existing) throw httpError(404, "RESTAURANT_NOT_FOUND", "Restaurant not found");
      res.json(existing);
      return;
    }
    const [row] = await db
      .update(restaurantsTable)
      .set(updates)
      .where(eq(restaurantsTable.id, id))
      .returning();
    if (!row) throw httpError(404, "RESTAURANT_NOT_FOUND", "Restaurant not found");
    res.json(row);
  }),
);

router.delete(
  "/restaurants/:id",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const result = await db
      .delete(restaurantsTable)
      .where(eq(restaurantsTable.id, id))
      .returning({ id: restaurantsTable.id });
    if (result.length === 0) throw httpError(404, "RESTAURANT_NOT_FOUND", "Restaurant not found");
    res.sendStatus(204);
  }),
);

export default router;
