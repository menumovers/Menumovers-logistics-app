// Seed the placeholder restaurant that parked orders (unresolved
// externalRestaurantId) are filed against. Idempotent: safe to re-run.
//
// Usage:
//   pnpm --filter @workspace/scripts exec tsx src/seed-unmapped-restaurant.ts
import { eq } from "drizzle-orm";
import { db, restaurantsTable } from "@workspace/db";

const UNMAPPED_RESTAURANT_NAME_CODE = "unmapped";

async function main(): Promise<void> {
  const [existing] = await db
    .select()
    .from(restaurantsTable)
    .where(eq(restaurantsTable.nameCode, UNMAPPED_RESTAURANT_NAME_CODE));
  if (existing) {
    console.log(`Placeholder restaurant already seeded (id: ${existing.id})`);
    process.exit(0);
  }

  const [created] = await db
    .insert(restaurantsTable)
    .values({
      name: "⚠ Unmapped — Needs Review",
      nameCode: UNMAPPED_RESTAURANT_NAME_CODE,
      address: "N/A — placeholder for orders with an unresolved external restaurant",
    })
    .returning();
  console.log(`Created placeholder restaurant (id: ${created!.id})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
