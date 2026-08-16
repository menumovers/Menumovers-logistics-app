---
name: DB schema sync requirement
description: After any schema change, db:live-drift must pass before the work is done — db:drift alone is insufficient.
---

# DB schema sync requirement

After any schema change (new columns, types, indexes, dropped columns), both drift checks must pass before the task is complete:

1. `pnpm --filter @workspace/db run db:drift` — checks that schema files have no uncommitted edits
2. `pnpm --filter @workspace/db run db:live-drift` — checks that the live database matches those files

**Why:** `db:drift` only compares schema files to git; it passes even when the live database has never received the migration. A previous task added `delivery_address_original`, `hold_state`, and several other columns to the schema but never pushed them to the live DB, causing the API to fail with "column does not exist" on every order query.

**How to apply:** If `db:live-drift` shows drift, apply it with `pnpm --filter @workspace/db run push-force` — but note that `drizzle-kit push` requires an interactive TTY for rename-detection prompts. Use `push-force` to auto-approve data loss, and pipe the migration directly via `executeSql` in CodeExecution when the prompt still hangs (as happened here).
