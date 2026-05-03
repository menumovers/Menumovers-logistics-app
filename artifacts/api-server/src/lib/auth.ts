import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  ridersTable,
  revokedTokensTable,
  type User,
  type UserRole,
} from "@workspace/db";
import { AppError } from "./errors";

const JWT_ALGO = "HS256";
const JWT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const BCRYPT_ROUNDS = 10;

function getJwtSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return secret;
}

export type AuthClaims = {
  sub: string; // user id
  role: UserRole;
  restaurantId: string | null;
  jti: string;
  exp: number;
};

export type AuthContext = AuthClaims & {
  /** Resolved server-side at requireAuth time for rider users; null otherwise. */
  riderId: string | null;
};

export type SignClaims = Omit<AuthClaims, "jti" | "exp">;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(claims: SignClaims): { token: string; jti: string; expiresAt: Date } {
  const jti = randomUUID();
  const opts: SignOptions = {
    algorithm: JWT_ALGO,
    expiresIn: JWT_TTL_SECONDS,
    jwtid: jti,
  };
  const token = jwt.sign(claims, getJwtSecret(), opts);
  const expiresAt = new Date(Date.now() + JWT_TTL_SECONDS * 1000);
  return { token, jti, expiresAt };
}

export function verifyToken(token: string): AuthClaims | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGO] });
    if (typeof decoded !== "object" || decoded === null) return null;
    const { sub, role, restaurantId, jti, exp } = decoded as Record<string, unknown>;
    if (
      typeof sub !== "string" ||
      typeof role !== "string" ||
      typeof jti !== "string" ||
      typeof exp !== "number"
    ) {
      return null;
    }
    return {
      sub,
      role: role as UserRole,
      restaurantId: typeof restaurantId === "string" ? restaurantId : null,
      jti,
      exp,
    };
  } catch {
    return null;
  }
}

export async function isJtiRevoked(jti: string): Promise<boolean> {
  const [row] = await db
    .select({ jti: revokedTokensTable.jti })
    .from(revokedTokensTable)
    .where(eq(revokedTokensTable.jti, jti));
  return Boolean(row);
}

export async function revokeJti(
  jti: string,
  userId: string | null,
  expiresAt: Date,
): Promise<void> {
  await db
    .insert(revokedTokensTable)
    .values({ jti, userId, expiresAt })
    .onConflictDoNothing({ target: revokedTokensTable.jti });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      auth?: AuthContext;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.header("authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const cookieToken = req.cookies?.["auth_token"];
  if (typeof cookieToken === "string" && cookieToken.length > 0) return cookieToken;
  return null;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    next(new AppError(401, "AUTH_REQUIRED", "Authentication required"));
    return;
  }
  const claims = verifyToken(token);
  if (!claims) {
    next(new AppError(401, "AUTH_INVALID", "Invalid or expired token"));
    return;
  }
  if (await isJtiRevoked(claims.jti)) {
    next(new AppError(401, "AUTH_REVOKED", "Session has been revoked"));
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.sub));
  if (!user) {
    next(new AppError(401, "AUTH_USER_MISSING", "User no longer exists"));
    return;
  }
  if (user.accountStatus !== "active") {
    next(new AppError(403, "ACCOUNT_SUSPENDED", "Account is suspended"));
    return;
  }
  let riderId: string | null = null;
  if (user.role === "rider") {
    const [rider] = await db
      .select({ id: ridersTable.id })
      .from(ridersTable)
      .where(eq(ridersTable.userId, user.id));
    riderId = rider?.id ?? null;
  }
  req.user = user;
  req.auth = {
    sub: user.id,
    role: user.role,
    restaurantId: user.restaurantId,
    riderId,
    jti: claims.jti,
    exp: claims.exp,
  };
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, "AUTH_REQUIRED", "Authentication required"));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError(403, "FORBIDDEN", "Forbidden"));
      return;
    }
    next();
  };
}

export function requireInboundSecret(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const expected = process.env["INBOUND_SHARED_SECRET"];
  if (!expected) {
    next(new AppError(503, "INBOUND_NOT_CONFIGURED", "Inbound endpoint not configured"));
    return;
  }
  const provided = req.header("x-inbound-secret");
  if (provided !== expected) {
    next(new AppError(401, "INBOUND_INVALID_SECRET", "Invalid inbound secret"));
    return;
  }
  next();
}

export function sanitizeUser(user: User): Omit<User, "passwordHash"> {
  // Strip the password hash from any user object before serializing.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _ph, ...safe } = user;
  return safe;
}
