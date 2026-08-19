// Bootstrap a single admin user. Idempotent: re-running with the same email
// updates the password hash and ensures the account is active.
//
// Usage:
//   ADMIN_EMAIL=admin@bestellenbij.nl ADMIN_PASSWORD=changeme ADMIN_NAME=Admin \
//     pnpm --filter @workspace/scripts exec tsx src/seed-admin.ts
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, userRolesTable } from "@workspace/db";

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

  let userId: string;
  if (existing) {
    await db
      .update(usersTable)
      .set({ passwordHash, accountStatus: "active", name })
      .where(eq(usersTable.id, existing.id));
    userId = existing.id;
    console.log(`Updated admin user ${email}`);
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({ email, passwordHash, name, accountStatus: "active" })
      .returning();
    userId = created!.id;
    console.log(`Created admin user ${email} (id: ${userId})`);
  }

  await db.insert(userRolesTable).values({ userId, role: "admin" }).onConflictDoNothing();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
