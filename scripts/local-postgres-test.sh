#!/usr/bin/env bash
# Throwaway localhost PostgreSQL for Appliance Desk integration tests.
# Never reads an existing DATABASE_URL and never connects to Neon/production.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: bash scripts/local-postgres-test.sh tests/<spec>.test.ts [more specs or Vitest flags]" >&2
  echo "Use --all to explicitly run the full Vitest suite." >&2
  exit 2
fi

if [ "$(id -u)" -eq 0 ]; then
  echo "Run as an ordinary user: initdb refuses root and no sudo is needed." >&2
  exit 2
fi

if [ -x /usr/lib/postgresql/18/bin/initdb ]; then
  BIN=/usr/lib/postgresql/18/bin
else
  BIN=""
  for dir in $(find /usr/lib/postgresql -maxdepth 2 -type d -name bin 2>/dev/null | sort -Vr); do
    if [ -x "$dir/initdb" ] && [ -x "$dir/pg_ctl" ]; then BIN="$dir"; break; fi
  done
fi
if [ -z "$BIN" ]; then
  echo "No local PostgreSQL server binaries found. Consult docs/PLAYBOOK.md Â§4b; never use Neon as a substitute." >&2
  exit 2
fi
for program in python3 psql node; do
  command -v "$program" >/dev/null || { echo "Missing $program" >&2; exit 2; }
done

WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/appliance-desk-postgres.XXXXXXXX")
PGDATA="$WORKDIR/data"
mkdir "$PGDATA" "$WORKDIR/socket"
started=0
cleanup() {
  if [ "$started" -eq 1 ]; then
    "$BIN/pg_ctl" -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1 || :
  fi
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    rm -rf -- "$WORKDIR"
  fi
}
trap cleanup EXIT INT TERM

# Ask the OS for a currently unused loopback port¶»§q«^