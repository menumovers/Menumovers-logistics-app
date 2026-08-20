import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  ridersTable,
  usersTable,
  type RiderAvailability,
} from "@workspace/db";
import { UpdateRiderBody, SetOwnAvailabilityBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth";
import { httpError } from "../lib/errors";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

const ACTIVE_STATUSES = [
  "rider_assigned",
  "rider_accepted",
  "en_route_to_restaurant",
  "arrived_at_restaurant",
  "picked_up",
  "en_route_to_customer",
] as const;

async function buildRiderViews(riderIds: string[]) {
  const riders = await db
    .select({
      id: ridersTable.id,
      userId: ridersTable.userId,
      nameCode: ridersTable.nameCode,
      phone: ridersTable.phone,
      availabilityStatus: ridersTable.availabilityStatus,
      name: usersTable.name,
      username: usersTable.username,
      accountStatus: usersTable.accountStatus,
    })
    .from(ridersTable)
    .innerJoin(usersTable, eq(usersTable.id, ridersTable.userId))
    .where(riderIds.length > 0 ? inArray(ridersTable.id, riderIds) : sql`TRUE`);

  // Workload counts.
  const counts = await db
    .select({
      riderId: ordersTable.riderId,
      status: ordersTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(ordersTable)
    .where(and(inArray(ordersTable.status, [...ACTIVE_STATUSES]), isNull(ordersTable.archivedAt)))
    .groupBy(ordersTable.riderId, ordersTable.status);

  const activeMap = new Map<string, number>();
  for (const row of counts) {
    if (!row.riderId) continue;
    activeMap.set(row.riderId, (activeMap.get(row.riderId) ?? 0) + Number(row.count));
  }

  return riders.map((r) => ({
    id: r.id,
    userId: r.userId,
    nameCode: r.nameCode,
    name: r.name,
    username: r.username,
    phone: r.phone,
    availabilityStatus: r.availabilityStatus,
    accountStatus: r.accountStatus,
    activeOrderCount: activeMap.get(r.id) ?? 0,
    queuedOrderCount: 0,
  }));
}

router.get(
  "/riders",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (_req, res) => {
    const all = await db.select({ id: ridersTable.id }).from(ridersTable);
    const views = await buildRiderViews(all.map((r) => r.id));
    res.json(views);
  }),
);

// Rider-specific profile fields only (nameCode/phone/availability). Account-level
// fields (username, password, roles) are managed via PATCH /users/:id.
router.patch(
  "/riders/:id",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = UpdateRiderBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);

    const [rider] = await db
      .select()
      .from(ridersTable)
      .where(eq(ridersTable.id, id));
    if (!rider) throw httpError(404, "RIDER_NOT_FOUND", "Rider not found");

    const riderUpdates: Partial<typeof ridersTable.$inferInsert> = {};
    if (parsed.data.nameCode !== undefined) riderUpdates.nameCode = parsed.data.nameCode;
    if (parsed.data.phone !== undefined) riderUpdates.phone = parsed.data.phone ?? null;
    if (parsed.data.availabilityStatus !== undefined) {
      riderUpdates.availabilityStatus = parsed.data.availabilityStatus as RiderAvailability;
    }
    if (Object.keys(riderUpdates).length > 0) {
      try {
        await db.update(ridersTable).set(riderUpdates).where(eq(ridersTable.id, id));
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("riders_name_code_unique")) {
          throw httpError(400, "NAME_CODE_CONFLICT", "A rider with that name code already exists");
        }
        throw err;
      }
    }

    const [view] = await buildRiderViews([id]);
    res.json(view);
  }),
);

router.post(
  "/riders/me/availability",
  requireAuth,
  requireRole("rider"),
  wrap(async (req, res) => {
    const auth = req.auth!;
    const parsed = SetOwnAvailabilityBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);

    const [rider] = await db
      .select()
      .from(ridersTable)
      .where(eq(ridersTable.userId, auth.sub));
    if (!rider) throw httpError(404, "RIDER_NOT_FOUND", "Rider profile missing");

    await db
      .update(ridersTable)
      .set({ availabilityStatus: parsed.data.availabilityStatus as RiderAvailability })
      .where(eq(ridersTable.id, rider.id));

    const [view] = await buildRiderViews([rider.id]);
    res.json(view);
  }),
);


export default router;
