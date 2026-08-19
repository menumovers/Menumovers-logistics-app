// STEP 1 of the users.role -> user_roles migration. Run this against the
// LIVE database BEFORE deploying the new schema/code (i.e. while `users.role`
// still exists) — it snapshots each user's current role into a plain backup
// table so `backfill-user-roles.ts` (STEP 2, run AFTER deploying) can restore
// it into `user_roles` once `drizzle-kit push` has created that table and
// dropped `users.role` in the same pass.
//
// Usage:
//   pnpm --filter @workspace/scripts exec tsx src/snapshot-user-roles.ts
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

async function main(): Promise<void> {
  await db.execute(sql`
    create table if not exists _role_backfill as
    select id as user_id, role from users
  `);
  const { rows } = await db.execute<{ count: string }>(
    sql`select count(*) as count from _role_backfill`,
  );
  console.log(`Snapshotted ${rows[0]?.count ?? 0} user role(s) into _role_backfill.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
