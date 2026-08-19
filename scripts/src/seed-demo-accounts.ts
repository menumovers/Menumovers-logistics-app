// Seed demo accounts for development/testing. Idempotent: safe to re-run.
// Creates linked rider/restaurant records where needed.
//
// Usage:
//   pnpm --filter @workspace/scripts exec tsx src/seed-demo-accounts.ts
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  userRolesTable,
  ridersTable,
  restaurantsTable,
  type UserRole,
} from "@workspace/db";

async function upsertUser(fields: typeof usersTable.$inferInsert, roles: UserRole[]) {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, fields.email));
  let userId: string;
  if (existing) {
    await db.update(usersTable).set(fields).where(eq(usersTable.id, existing.id));
    userId = existing.id;
    console.log(`Updated  ${roles.join("+").padEnd(24)} ${fields.email}`);
  } else {
    const [created] = await db.insert(usersTable).values(fields).returning();
    userId = created!.id;
    console.log(`Created  ${roles.join("+").padEnd(24)} ${fields.email}  (id: ${userId})`);
  }
  await db
    .insert(userRolesTable)
    .values(roles.map((role) => ({ userId, role })))
    .onConflictDoNothing();
  return userId;
}

async function main(): Promise<void> {
  const hash = await bcrypt.hash("password", 10);

  // Admin — also granted coordinator + rider, since on the logistics side an
  // admin routinely needs to act in those capacities too.
  await upsertUser(
    { email: "admin@bestellenbij.nl", passwordHash: hash, name: "Beheerder1", accountStatus: "active" },
    ["admin", "coordinator"],
  );

  // Coordinator
  await upsertUser(
    { email: "coordinator@bestellenbij.nl", passwordHash: hash, name: "Coördinator1", accountStatus: "active" },
    ["coordinator"],
  );

  // Rider — needs a riders row
  const [existingRider] = await db
    .select()
    .from(ridersTable)
    .where(eq(ridersTable.nameCode, "rijder1"));

  const riderUserId = await upsertUser(
    { email: "rider1@bestellenbij.nl", passwordHash: hash, name: "Rijder1", accountStatus: "active" },
    ["rider"],
  );
  if (!existingRider) {
    const [r] = await db
      .insert(ridersTable)
      .values({ userId: riderUserId, nameCode: "rijder1", availabilityStatus: "offline" })
      .returning();
    console.log(`Created  rider record              (id: ${r!.id})`);
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

  await upsertUser(
    {
      email: "restaurant1@bestellenbij.nl",
      passwordHash: hash,
      name: "Restaurant1",
      restaurantId: restaurant.id,
      accountStatus: "active",
    },
    ["restaurant_staff"],
  );

  console.log("\nAll demo accounts ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
