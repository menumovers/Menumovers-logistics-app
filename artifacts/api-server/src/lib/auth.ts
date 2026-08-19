import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  ridersTable,
  userRolesTable,
  revokedTokensTable,
  type User,
  type UserRole,
} from "@workspace/db";
import { AppError } from "./errors";
import { findActiveCredential } from "./inbound-credentials";

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
  roles: UserRole[];
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
    const { sub, roles, restaurantId, jti, exp } = decoded as Record<string, unknown>;
    if (
      typeof sub !== "string" ||
      !Array.isArray(roles) ||
      roles.length === 0 ||
      !roles.every((r) => typeof r === "string") ||
      typeof jti !== "string" ||
      typeof exp !== "number"
    ) {
      return null;
    }
    return {
      sub,
      roles: roles as UserRole[],
      restaurantId: typeof restaurantId === "string" ? restaurantId : null,
      jti,
      exp,
    };
  } catch {
    return null;
  }
}

/** Resolves the riderId for a user, if "rider" is among their roles. */
export async function resolveRiderId(userId: string, roles: UserRole[]): Promise<string | null> {
  if (!roles.includes("rider")) return null;
  const [rider] = await db
    .select({ id: ridersTable.id })
    .from(ridersTable)
    .where(eq(ridersTable.userId, userId));
  return rider?.id ?? null;
}

/** Loads all roles currently granted to a user. */
export async function loadUserRoles(userId: string): Promise<UserRole[]> {
  const rows = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));
  if (rows.length > 0) return rows.map((r) => r.role);

  const [user] = await db
    .select({ legacyRole: usersTable.legacyRole })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return user?.legacyRole ? [user.legacyRole] : [];
}

const ROLE_LOG_PRIORITY: UserRole[] = ["admin", "coordinator", "restaurant_staff", "rider"];

/**
 * Picks one role to attribute an action to in free-text `actorRole` log
 * columns, for a user who may hold several roles at once.
 */
export function primaryRoleLabel(roles: UserRole[]): UserRole {
  return ROLE_LOG_PRIORITY.find((r) => roles.includes(r)) ?? roles[0]!;
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
      /** Set by requireInboundCredential: the source the matched credential belongs to. */
      inboundSource?: string;
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
  const roles = await loadUserRoles(user.id);
  const riderId = await resolveRiderId(user.id, roles);
  req.user = user;
  req.auth = {
    sub: user.id,
    roles,
    restaurantId: user.restaurantId,
    riderId,
    jti: claims.jti,
    exp: claims.exp,
  };
  next();
}

export function requireRole(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError(401, "AUTH_REQUIRED", "Authentication required"));
      return;
    }
    if (!allowed.some((r) => req.auth!.roles.includes(r))) {
      next(new AppError(403, "FORBIDDEN", "Forbidden"));
      return;
    }
    next();
  };
}

export async function requireInboundCredential(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const provided = req.header("x-inbound-secret");
  if (!provided) {
    next(new AppError(401, "INBOUND_MISSING_SECRET", "Missing x-inbound-secret header"));
    return;
  }
  const credential = await findActiveCredential(provided);
  if (!credential) {
    next(new AppError(401, "INBOUND_INVALID_SECRET", "Invalid or revoked inbound credential"));
    return;
  }
  req.inboundSource = credential.source;
  next();
}

export function sanitizeUser(user: User): Omit<User, "passwordHash" | "legacyRole"> {
  // Strip private and migration-only fields before serializing.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _ph, legacyRole: _legacyRole, ...safe } = user;
  return safe;
}
