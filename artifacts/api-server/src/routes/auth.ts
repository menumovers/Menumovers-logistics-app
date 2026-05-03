import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, ridersTable } from "@workspace/db";
import { LoginBody, LoginResponse as LoginResponseZod, GetCurrentUserResponse } from "@workspace/api-zod";
import {
  verifyPassword,
  signToken,
  requireAuth,
  revokeJti,
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

  const { token } = signToken({
    sub: user.id,
    role: user.role,
    restaurantId: user.restaurantId,
  });

  let riderId: string | null = null;
  if (user.role === "rider") {
    const [rider] = await db
      .select({ id: ridersTable.id })
      .from(ridersTable)
      .where(eq(ridersTable.userId, user.id));
    riderId = rider?.id ?? null;
  }

  const body = LoginResponseZod.parse({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
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
  let riderId: string | null = null;
  if (user.role === "rider") {
    const [rider] = await db
      .select({ id: ridersTable.id })
      .from(ridersTable)
      .where(eq(ridersTable.userId, user.id));
    riderId = rider?.id ?? null;
  }
  res.json(
    GetCurrentUserResponse.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      accountStatus: user.accountStatus,
      restaurantId: user.restaurantId,
      riderId,
      preferredLocale: normalizeLocale(user.preferredLocale),
    }),
  );
});

export default router;
