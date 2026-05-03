// Bootstrap a single admin user. Idempotent: re-running with the same email
// updates the password hash and ensures the account is active.
//
// Usage:
//   ADMIN_EMAIL=admin@bestellenbij.nl ADMIN_PASSWORD=changeme ADMIN_NAME=Admin \
//     pnpm --filter @workspace/scripts exec tsx src/seed-admin.ts
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

async function main(): Promise<void> {
  const email = process.env["ADMIN_EMAIL"]?.toLowerCase();
  const password = process.env["ADMIN_PASSWORD"];
  const name = process.env["ADMIN_NAME"] ?? "Administrator";

  if (!email || !password) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (existing) {
    await db
      .update(usersTable)
      .set({ passwordHash, accountStatus: "active", role: "admin", name })
      .where(eq(usersTable.id, existing.id));
    console.log(`Updated admin user ${email}`);
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({ email, passwordHash, name, role: "admin", accountStatus: "active" })
      .returning();
    console.log(`Created admin user ${email} (id: ${created!.id})`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
