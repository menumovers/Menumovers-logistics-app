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

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));

  if (!user) {
    req.log.warn({ email }, "Login: unknown email");
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (user.accountStatus !== "active") {
    res.status(403).json({ error: "Account is suspended" });
    return;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    req.log.warn({ userId: user.id }, "Login: bad password");
    res.status(401).json({ error: "Invalid credentials" });
    return;
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
    }),
  );
});

export default router;
