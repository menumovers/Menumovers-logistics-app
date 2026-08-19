---
name: Drizzle temporary-table safety
description: Why ad-hoc database backup tables cannot safely bridge a Drizzle push.
---

Do not store data needed after a `drizzle-kit push` in an ad-hoc table that is absent from the Drizzle schema. Push reconciles the database to the schema and can remove such a table, even when its table-conflict prompt is resolved as “create” for a new schema table.

**Why:** A role-migration snapshot stored in an unmodelled `_role_backfill` table was removed by the schema push before the restore step could read it.

**How to apply:** For any backfill that spans a schema push, use a schema-represented staging table or a migration approach that does not depend on unmodelled database state. Verify the staging row count immediately after the schema operation and before any destructive cleanup.