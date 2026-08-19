import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, ridersTable } from "@workspace/db";
import { LoginBody, LoginResponse as LoginResponseZod, GetCurrentUserResponse } from "@workspace/api-zod";
import {
  verifyPassword,
  signToken,
  requireAuth,
  revokeJti,
  loadUserRoles,
  resolveRiderId,
} from "../lib/auth";
import { AppError } from "../lib/errors";

const router: IRouter = Router();

function normalizeLocale(value: string | null): "nl" | "en" | null {
  if (value === "nl" || value === "en") return value;
  return null;
}

router.post("/auth/login", async (req, res, next): Promise<void> => {
  try {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", parsed.error.message);
  }

  const { email, password } = parsed.data;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));

  if (!user) {
    req.log.warn({ email }, "Login: unknown email");
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid credentials");
  }

  if (user.accountStatus !== "active") {
    throw new AppError(403, "ACCOUNT_SUSPENDED", "Account is suspended");
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    req.log.warn({ userId: user.id }, "Login: bad password");
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid credentials");
  }

  const roles = await loadUserRoles(user.id);
  if (roles.length === 0) {
    throw new AppError(403, "NO_ROLES", "User has no roles assigned");
  }

  const { token } = signToken({
    sub: user.id,
    roles,
    restaurantId: user.restaurantId,
  });

  const riderId = await resolveRiderId(user.id, roles);

  const body = LoginResponseZod.parse({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
      accountStatus: user.accountStatus,
      restaurantId: user.restaurantId,
      riderId,
      preferredLocale: normalizeLocale(user.preferredLocale),
    },
  });
  res.cookie("auth_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.json(body);
  } catch (err) { next(err); }
});

router.post("/auth/logout", requireAuth, async (req, res): Promise<void> => {
  const auth = req.auth!;
  await revokeJti(auth.jti, auth.sub, new Date(auth.exp * 1000));
  res.clearCookie("auth_token", { path: "/" });
  res.sendStatus(204);
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const auth = req.auth!;
  let availabilityStatus: (typeof ridersTable.$inferSelect)["availabilityStatus"] | null = null;
  if (auth.riderId) {
    const [rider] = await db
      .select({ availabilityStatus: ridersTable.availabilityStatus })
      .from(ridersTable)
      .where(eq(ridersTable.id, auth.riderId));
    availabilityStatus = rider?.availabilityStatus ?? null;
  }
  res.json(
    GetCurrentUserResponse.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      roles: auth.roles,
      accountStatus: user.accountStatus,
      restaurantId: user.restaurantId,
      riderId: auth.riderId,
      availabilityStatus,
      preferredLocale: normalizeLocale(user.preferredLocale),
    }),
  );
});

export default router;
