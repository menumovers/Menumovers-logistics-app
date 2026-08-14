// Seed demo accounts for development/testing. Idempotent: safe to re-run.
// Creates linked rider/restaurant records where needed.
//
// Usage:
//   pnpm --filter @workspace/scripts exec tsx src/seed-demo-accounts.ts
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, ridersTable, restaurantsTable } from "@workspace/db";

async function upsertUser(fields: typeof usersTable.$inferInsert) {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, fields.email));
  if (existing) {
    await db.update(usersTable).set(fields).where(eq(usersTable.id, existing.id));
    console.log(`Updated  ${fields.role.padEnd(16)} ${fields.email}`);
    return existing.id;
  }
  const [created] = await db.insert(usersTable).values(fields).returning();
  console.log(`Created  ${fields.role.padEnd(16)} ${fields.email}  (id: ${created!.id})`);
  return created!.id;
}

async function main(): Promise<void> {
  const hash = await bcrypt.hash("password", 10);

  // Admin
  await upsertUser({
    email: "admin@bestellenbij.nl",
    passwordHash: hash,
    name: "Beheerder1",
    role: "admin",
    accountStatus: "active",
  });

  // Coordinator
  await upsertUser({
    email: "coordinator@bestellenbij.nl",
    passwordHash: hash,
    name: "Coördinator1",
    role: "coordinator",
    accountStatus: "active",
  });

  // Rider — needs a riders row first
  const [existingRider] = await db
    .select()
    .from(ridersTable)
    .where(eq(ridersTable.nameCode, "rijder1"));
  const riderRow =
    existingRider ??
    (await (async () => {
      // Create a placeholder user first so we can link it; we'll update after
      const placeholderUserId = await upsertUser({
        email: "rider1@bestellenbij.nl",
        passwordHash: hash,
        name: "Rijder1",
        role: "rider",
        accountStatus: "active",
      });
      const [r] = await db
        .insert(ridersTable)
        .values({ userId: placeholderUserId, nameCode: "rijder1", availabilityStatus: "offline" })
        .returning();
      console.log(`Created  rider record              (id: ${r!.id})`);
      return r!;
    })());

  // Ensure the rider user exists and is linked (idempotent path)
  if (existingRider) {
    await upsertUser({
      email: "rider1@bestellenbij.nl",
      passwordHash: hash,
      name: "Rijder1",
      role: "rider",
      accountStatus: "active",
    });
  }

  // Restaurant staff — needs a restaurants row
  const [existingRestaurant] = await db
    .select()
    .from(restaurantsTable)
    .where(eq(restaurantsTable.nameCode, "restaurant1"));
  const restaurant =
    existingRestaurant ??
    (await (async () => {
      const [r] = await db
        .insert(restaurantsTable)
        .values({
          name: "Restaurant1",
          nameCode: "restaurant1",
          address: "Demo straat 1, Amsterdam",
        })
        .returning();
      console.log(`Created  restaurant record          (id: ${r!.id})`);
      return r!;
    })());

  await upsertUser({
    email: "restaurant1@bestellenbij.nl",
    passwordHash: hash,
    name: "Restaurant1",
    role: "restaurant_staff",
    restaurantId: restaurant.id,
    accountStatus: "active",
  });

  console.log("\nAll demo accounts ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
