/**
 * Live-database drift guard for the push-based Drizzle workflow.
 *
 * This project applies schema changes with `drizzle-kit push` (no migration
 * files), so the only reliable way to detect true divergence is to diff the
 * Drizzle schema in `src/schema` against the *actual* live database.
 *
 * It uses drizzle-kit's programmatic `pushSchema` API, which computes the exact
 * set of SQL statements that a `push` would run WITHOUT applying them (it never
 * calls the returned `apply()`), so this check is strictly read-only.
 *
 * `pushSchema` uses the same "push" diff semantics as `drizzle-kit push`, which
 * is important: a plain snapshot diff (`generateMigration`) reports spurious
 * differences (e.g. index representation) that `push` itself would not act on.
 *
 * One wrinkle: for a `create unique constraint` on a table that already has
 * rows, drizzle-kit renders an interactive terminal prompt asking whether to
 * truncate. That prompt hangs (or is silently abandoned) when there is no TTY,
 * which would make this check unusable in CI. We defeat it by swapping
 * `process.stdin` for a stream that continuously answers "No, add the
 * constraint without truncating" — the default, non-destructive choice. This
 * never truncates and never applies anything; it only lets `pushSchema` finish
 * so it can return the full list of diverging statements.
 *
 * Exit codes:
 *   0 — the live database matches the schema (no statements to execute).
 *   1 — drift detected (statements would be needed) or an error occurred.
 *
 * This complements `db-drift.sh`, which only catches schema files that were
 * edited but not committed. This one catches manual DB changes and partially
 * failed pushes that leave the live database out of sync with the schema.
 */
import { PassThrough } from "node:stream";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "../src/schema";

type PushResult = {
  hasDataLoss: boolean;
  warnings: string[];
  statementsToExecute: string[];
};

/**
 * Runs `pushSchema` with `process.stdin` swapped for a stream that keeps
 * answering the interactive truncate prompt with its default, non-destructive
 * option, so the check never blocks on a missing TTY.
 */
async function pushSchemaNonInteractive(
  db: PgDatabase<any>,
): Promise<PushResult> {
  const originalStdin = process.stdin;
  const fakeStdin = new PassThrough();
  (fakeStdin as unknown as { isTTY: boolean }).isTTY = false;

  Object.defineProperty(process, "stdin", {
    value: fakeStdin,
    configurable: true,
  });

  // "\r" is parsed as the "return" keypress, which submits the currently
  // highlighted option. The first option is always the non-destructive
  // "No, add the constraint without truncating the table".
  const answerTimer = setInterval(() => {
    fakeStdin.write("\r");
  }, 20);

  try {
    const { hasDataLoss, warnings, statementsToExecute } = await pushSchema(
      schema as Record<string, unknown>,
      db,
    );
    return { hasDataLoss, warnings, statementsToExecute };
  } finally {
    clearInterval(answerTimer);
    Object.defineProperty(process, "stdin", {
      value: originalStdin,
      configurable: true,
    });
    fakeStdin.end();
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "db:live-drift — DATABASE_URL is not set. Ensure the database is provisioned.",
    );
    process.exitCode = 1;
    return;
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  try {
    const { statementsToExecute, hasDataLoss, warnings } =
      await pushSchemaNonInteractive(db);

    if (statementsToExecute.length === 0) {
      console.log(
        "db:live-drift — no drift: the live database matches the Drizzle schema in src/schema.",
      );
      return;
    }

    console.error(
      "db:live-drift — live database drift detected. The live database does NOT match the Drizzle schema in src/schema.",
    );
    console.error(
      `\nReconciling the schema would require ${statementsToExecute.length} statement(s):\n`,
    );
    for (const statement of statementsToExecute) {
      console.error(`  ${statement}`);
    }
    if (warnings.length > 0) {
      console.error("\nWarnings:");
      for (const warning of warnings) {
        console.error(`  ${warning}`);
      }
    }
    if (hasDataLoss) {
      console.error(
        "\nWARNING: reconciling this drift may cause data loss. Review carefully before running push.",
      );
    }
    console.error(
      "\nThe schema and the live database have diverged (e.g. a manual DB change or a push that partially failed).",
    );
    console.error(
      "Run 'pnpm --filter @workspace/db run push' to reconcile the database with the schema, or update the schema to match the database.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("db:live-drift — failed to check live database drift:");
  console.error(error);
  process.exitCode = 1;
});
