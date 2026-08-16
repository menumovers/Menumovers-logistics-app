#!/usr/bin/env bash
# Start a throwaway PostgreSQL for local verification.
#
# Written after a full day of "this can't be verified without a database" —
# PostgreSQL 16 was installed the whole time and nobody checked. Nothing here
# needs Docker or a hosted instance.
#
#   ./scripts/local-db.sh start   → prints a DATABASE_URL to export
#   ./scripts/local-db.sh stop
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/tmp/pgdata}
PGPORT=${PGPORT:-55432}
PGSOCK=${PGSOCK:-/var/tmp}
# initdb refuses to run as root, so the server runs as an unprivileged user.
PGUSER_OS=${PGUSER_OS:-pgrunner}

case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA/base" ]; then
      id -u "$PGUSER_OS" >/dev/null 2>&1 || useradd -M -s /bin/bash "$PGUSER_OS"
      rm -rf "$PGDATA"; mkdir -p "$PGDATA"
      chown "$PGUSER_OS" "$PGDATA"; chmod 700 "$PGDATA"
      su "$PGUSER_OS" -c "$PGBIN/initdb -D $PGDATA -U postgres -A trust" >/dev/null
    fi
    su "$PGUSER_OS" -c "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGSOCK' -l /var/tmp/pg.log start" >/dev/null
    sleep 2
    psql -h "$PGSOCK" -p "$PGPORT" -U postgres -tc \
      "select 1 from pg_database where datname='menumovers'" | grep -q 1 ||
      psql -h "$PGSOCK" -p "$PGPORT" -U postgres -qc "create database menumovers"
    echo "export DATABASE_URL=\"postgres://postgres@localhost:$PGPORT/menumovers\""
    ;;
  stop)
    su "$PGUSER_OS" -c "$PGBIN/pg_ctl -D $PGDATA stop" >/dev/null 2>&1 || true
    echo "stopped"
    ;;
  *) echo "usage: $0 [start|stop]" >&2; exit 1 ;;
esac
