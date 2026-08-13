// Provision a new per-source inbound API credential.
//
// Usage:
//   INBOUND_SOURCE=bestellenbij pnpm --filter @workspace/scripts exec tsx src/provision-inbound-credential.ts
//
// Refuses to run if an active credential for the source already exists —
// revoke it first (directly in the DB; there is no revoke script yet, this
// is a fresh-integration tool). Prints the raw key exactly once: store it
// immediately as the caller's outbound secret. Only the SHA-256 hash is
// persisted.
import { randomBytes, createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, apiCredentialsTable } from "@workspace/db";

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

async function main(): Promise<void> {
  const source = process.env["INBOUND_SOURCE"];
  if (!source) {
    console.error("INBOUND_SOURCE environment variable is required (e.g. 'bestellenbij')");
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: apiCredentialsTable.id })
    .from(apiCredentialsTable)
    .where(and(eq(apiCredentialsTable.source, source), eq(apiCredentialsTable.status, "active")));
  if (existing) {
    console.error(
      `An active credential for source '${source}' already exists (id: ${existing.id}). ` +
        "Revoke it first before provisioning a new one.",
    );
    process.exit(1);
  }

  const rawKey = randomBytes(32).toString("hex");
  const [credential] = await db
    .insert(apiCredentialsTable)
    .values({ keyHash: hashKey(rawKey), source, status: "active" })
    .returning();

  console.log("====================================================");
  console.log(`Inbound credential provisioned for source '${source}'.`);
  console.log("Credential ID:", credential!.id);
  console.log("");
  console.log("RAW KEY (copy this now — it will NOT be shown again):");
  console.log(rawKey);
  console.log("");
  console.log("The caller must send this as the x-inbound-secret header.");
  console.log("====================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
