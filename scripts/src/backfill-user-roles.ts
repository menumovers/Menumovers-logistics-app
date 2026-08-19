// STEP 2 of the users.role -> user_roles migration. Run this AFTER deploying
// the new schema (i.e. after `pnpm --filter @workspace/db run push` has
// created `user_roles` and dropped `users.role`). Restores each user's role
// from the `_role_backfill` snapshot table created by `snapshot-user-roles.ts`
// (STEP 1, run before deploying), then drops that snapshot table.
// Idempotent — safe to re-run (onConflictDoNothing on the unique userId+role index).
//
// Usage:
//   pnpm --filter @workspace/scripts exec tsx src/backfill-user-roles.ts
import { sql } from "drizzle-orm";
import { db, userRolesTable } from "@workspace/db";

async function main(): Promise<void> {
  const { rows } = await db.execute<{ user_id: string; role: string }>(
    sql`select user_id, role from _role_backfill`,
  );

  let inserted = 0;
  for (const row of rows) {
    const result = await db
      .insert(userRolesTable)
      .values({ userId: row.user_id, role: row.role as never })
      .onConflictDoNothing();
    if (result.rowCount) inserted += result.rowCount;
  }

  await db.execute(sql`drop table if exists _role_backfill`);
  console.log(`Backfilled ${inserted} user_roles row(s) from ${rows.length} snapshotted user(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
