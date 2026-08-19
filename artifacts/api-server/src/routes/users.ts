import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  userRolesTable,
  ridersTable,
  type User,
  type UserRole,
  type RiderAvailability,
} from "@workspace/db";
import {
  CreateUserBody,
  UpdateUserBody,
  UpdateMyLocaleBody,
  GetRoleMigrationStatusResponse,
  InitializeLegacyRolesResponse,
} from "@workspace/api-zod";
import { hashPassword, requireAuth, requireRole } from "../lib/auth";
import { httpError } from "../lib/errors";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

async function loadRolesMap(
  users: Array<Pick<User, "id" | "legacyRole">>,
): Promise<Map<string, UserRole[]>> {
  const userIds = users.map((user) => user.id);
  const rows = await db
    .select({ userId: userRolesTable.userId, role: userRolesTable.role })
    .from(userRolesTable)
    .where(userIds.length > 0 ? inArray(userRolesTable.userId, userIds) : sql`TRUE`);
  const map = new Map<string, UserRole[]>();
  for (const row of rows) {
    const arr = map.get(row.userId) ?? [];
    arr.push(row.role);
    map.set(row.userId, arr);
  }
  for (const user of users) {
    if (!map.has(user.id) && user.legacyRole) {
      map.set(user.id, [user.legacyRole]);
    }
  }
  return map;
}

function toUserView(user: User, roles: UserRole[]) {
  const {
    passwordHash: _passwordHash,
    legacyRole: _legacyRole,
    updatedAt: _updatedAt,
    preferredLocale: _preferredLocale,
    ...safe
  } = user;
  return { ...safe, roles };
}

async function userView(id: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) return null;
  const rolesMap = await loadRolesMap([user]);
  return toUserView(user, rolesMap.get(id) ?? []);
}

async function roleMigrationStatus() {
  const [users, roleRows] = await Promise.all([
    db.select({ id: usersTable.id, legacyRole: usersTable.legacyRole }).from(usersTable),
    db.select({ userId: userRolesTable.userId }).from(userRolesTable),
  ]);
  const usersWithRoleRows = new Set(roleRows.map((row) => row.userId));
  const usersWithoutRoleRows = users.filter((user) => !usersWithRoleRows.has(user.id));
  return {
    totalUsers: users.length,
    usersWithRoleRows: usersWithRoleRows.size,
    usersWithoutRoleRows: usersWithoutRoleRows.length,
    legacyUsersPending: usersWithoutRoleRows.filter((user) => user.legacyRole !== null).length,
    readyToRemoveLegacyRole: usersWithoutRoleRows.length === 0,
  };
}

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
    const rolesMap = await loadRolesMap(users);
    res.json(
      users.map((u) => {
        return toUserView(u, rolesMap.get(u.id) ?? []);
      }),
    );
  }),
);

router.get(
  "/users/role-migration",
  requireAuth,
  requireRole("admin"),
  wrap(async (_req, res) => {
    res.json(GetRoleMigrationStatusResponse.parse(await roleMigrationStatus()));
  }),
);

router.post(
  "/users/role-migration",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const inserted = await db.transaction(async (tx) => {
      const users = await tx
        .select({ id: usersTable.id, legacyRole: usersTable.legacyRole })
        .from(usersTable)
        .orderBy(usersTable.id)
        .for("update");
      const roleRows = await tx.select({ userId: userRolesTable.userId }).from(userRolesTable);
      const usersWithRoleRows = new Set(roleRows.map((row) => row.userId));
      const candidates = users.filter(
        (user): user is { id: string; legacyRole: UserRole } =>
          !usersWithRoleRows.has(user.id) && user.legacyRole !== null,
      );
      if (candidates.length === 0) return [];
      return tx
        .insert(userRolesTable)
        .values(candidates.map((user) => ({ userId: user.id, role: user.legacyRole })))
        .onConflictDoNothing()
        .returning({ userId: userRolesTable.userId });
    });

    const status = await roleMigrationStatus();
    const initializedUsers = new Set(inserted.map((row) => row.userId)).size;
    req.log.info(
      { initializedUsers, insertedRoleRows: inserted.length, ...status },
      "Initialized legacy user roles",
    );
    res.json(
      InitializeLegacyRolesResponse.parse({
        ...status,
        initializedUsers,
        insertedRoleRows: inserted.length,
      }),
    );
  }),
);

router.post(
  "/users",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const parsed = CreateUserBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    const { email, name, password, roles, restaurantId, riderProfile } = parsed.data;
    const wantsRestaurantStaff = roles.includes("restaurant_staff");
    const wantsRider = roles.includes("rider");

    if (wantsRestaurantStaff && !restaurantId) {
      throw httpError(400, "RESTAURANT_REQUIRED", "restaurantId is required for restaurant_staff");
    }
    if (wantsRider && !riderProfile?.nameCode) {
      throw httpError(400, "RIDER_PROFILE_REQUIRED", "riderProfile.nameCode is required for rider");
    }

    const passwordHash = await hashPassword(password);

    let userId: string;
    try {
      userId = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(usersTable)
          .values({
            email: email.toLowerCase(),
            name,
            passwordHash,
            restaurantId: wantsRestaurantStaff ? (restaurantId ?? null) : null,
          })
          .returning();
        if (!user) throw httpError(500, "DB_ERROR", "Failed to create user");

        await tx.insert(userRolesTable).values(roles.map((role) => ({ userId: user.id, role })));

        if (wantsRider && riderProfile) {
          await tx.insert(ridersTable).values({
            userId: user.id,
            nameCode: riderProfile.nameCode,
            phone: riderProfile.phone ?? null,
            availabilityStatus: (riderProfile.availabilityStatus as RiderAvailability) ?? "offline",
          });
        }

        return user.id;
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("riders_name_code_unique")) {
        throw httpError(400, "NAME_CODE_CONFLICT", "A rider with that name code already exists");
      }
      throw err;
    }

    const view = await userView(userId);
    if (!view) throw httpError(500, "DB_ERROR", "Failed to load created user");
    res.status(201).json(view);
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
    const data = parsed.data;
    const nextPasswordHash =
      data.password !== undefined ? await hashPassword(data.password) : undefined;

    try {
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, id))
          .for("update");
        if (!existing) throw httpError(404, "USER_NOT_FOUND", "User not found");

        const currentRoleRows = await tx
          .select({ role: userRolesTable.role })
          .from(userRolesTable)
          .where(eq(userRolesTable.userId, id));
        const assignedRoles = currentRoleRows.map((row) => row.role);
        const currentRoles =
          assignedRoles.length > 0
            ? assignedRoles
            : existing.legacyRole
              ? [existing.legacyRole]
              : [];
        const nextRoles = data.roles ?? currentRoles;
        const wantsRestaurantStaff = nextRoles.includes("restaurant_staff");
        const wantsRider = nextRoles.includes("rider");

        if (wantsRestaurantStaff) {
          const nextRestaurantId =
            data.restaurantId !== undefined ? data.restaurantId : existing.restaurantId;
          if (!nextRestaurantId) {
            throw httpError(
              400,
              "RESTAURANT_REQUIRED",
              "restaurantId is required for restaurant_staff",
            );
          }
        }

        const [existingRider] = await tx
          .select()
          .from(ridersTable)
          .where(eq(ridersTable.userId, id));
        if (wantsRider && !existingRider && !data.riderProfile?.nameCode) {
          throw httpError(
            400,
            "RIDER_PROFILE_REQUIRED",
            "riderProfile.nameCode is required for rider",
          );
        }

        const userUpdates: Partial<typeof usersTable.$inferInsert> = {};
        if (data.email !== undefined) userUpdates.email = data.email.toLowerCase();
        if (data.name !== undefined) userUpdates.name = data.name;
        if (data.accountStatus !== undefined) userUpdates.accountStatus = data.accountStatus;
        if (nextPasswordHash !== undefined) userUpdates.passwordHash = nextPasswordHash;
        // restaurantId only ever meaningful when restaurant_staff is among the final roles.
        userUpdates.restaurantId = wantsRestaurantStaff
          ? (data.restaurantId !== undefined ? data.restaurantId : existing.restaurantId)
          : null;

        if (Object.keys(userUpdates).length > 0) {
          await tx.update(usersTable).set(userUpdates).where(eq(usersTable.id, id));
        }

        if (data.roles !== undefined) {
          const added = nextRoles.filter((r) => !assignedRoles.includes(r));
          const removed = assignedRoles.filter((r) => !nextRoles.includes(r));
          if (removed.length > 0) {
            await tx
              .delete(userRolesTable)
              .where(and(eq(userRolesTable.userId, id), inArray(userRolesTable.role, removed)));
          }
          if (added.length > 0) {
            await tx
              .insert(userRolesTable)
              .values(added.map((role) => ({ userId: id, role })))
              .onConflictDoNothing();
          }
        }

        if (wantsRider) {
          if (existingRider) {
            const riderUpdates: Partial<typeof ridersTable.$inferInsert> = {};
            if (data.riderProfile?.nameCode !== undefined) riderUpdates.nameCode = data.riderProfile.nameCode;
            if (data.riderProfile?.phone !== undefined) riderUpdates.phone = data.riderProfile.phone ?? null;
            if (data.riderProfile?.availabilityStatus !== undefined) {
              riderUpdates.availabilityStatus = data.riderProfile.availabilityStatus as RiderAvailability;
            }
            if (Object.keys(riderUpdates).length > 0) {
              await tx.update(ridersTable).set(riderUpdates).where(eq(ridersTable.id, existingRider.id));
            }
          } else if (data.riderProfile) {
            await tx.insert(ridersTable).values({
              userId: id,
              nameCode: data.riderProfile.nameCode,
              phone: data.riderProfile.phone ?? null,
              availabilityStatus: (data.riderProfile.availabilityStatus as RiderAvailability) ?? "offline",
            });
          }
        }
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("riders_name_code_unique")) {
        throw httpError(400, "NAME_CODE_CONFLICT", "A rider with that name code already exists");
      }
      throw err;
    }

    const view = await userView(id);
    if (!view) throw httpError(404, "USER_NOT_FOUND", "User not found");
    res.json(view);
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
