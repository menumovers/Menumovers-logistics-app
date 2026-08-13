import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, apiCredentialsTable, type ApiCredential } from "@workspace/db";

export function hashInboundKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateInboundKey(): string {
  return randomBytes(32).toString("hex");
}

export async function findActiveCredential(rawKey: string): Promise<ApiCredential | null> {
  const keyHash = hashInboundKey(rawKey);
  const [credential] = await db
    .select()
    .from(apiCredentialsTable)
    .where(eq(apiCredentialsTable.keyHash, keyHash));
  if (!credential || credential.status !== "active") return null;
  return credential;
}

export async function countActiveCredentials(): Promise<number> {
  const rows = await db
    .select({ id: apiCredentialsTable.id })
    .from(apiCredentialsTable)
    .where(eq(apiCredentialsTable.status, "active"));
  return rows.length;
}
