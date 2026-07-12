#!/bin/bash
# Schema-drift guard for the push-based Drizzle workflow.
#
# This project applies schema changes with `drizzle-kit push` (no migration
# files), so there is no migration artifact to diff against. Instead, this
# guard checks git for uncommitted changes under src/schema/: if the schema
# was edited but not committed, `push` may not have been run against the
# database. It exits non-zero so CI / post-merge reconciliation can flag it.
#
# NOTE: this is a weaker guard than a migration-based drift check — it catches
# "schema edited but not committed/pushed", NOT live database divergence.
set -euo pipefail

SCHEMA_DIR="src/schema"
DIRTY="$(git status --porcelain -- "$SCHEMA_DIR")"

if [ -z "$DIRTY" ]; then
  echo "db:drift — no schema drift: $SCHEMA_DIR has no uncommitted changes."
  exit 0
fi

echo "db:drift — schema drift detected. The following files under $SCHEMA_DIR have uncommitted changes:"
echo "$DIRTY"
echo ""
echo "Schema was edited but not committed. Run 'pnpm --filter @workspace/db run push' to apply it to the database, then commit the schema changes."
exit 1
