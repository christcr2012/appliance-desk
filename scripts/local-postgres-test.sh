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
  echo "No local PostgreSQL server binaries found. Consult docs/PLAYBOOK.md §4b; never use Neon as a substitute." >&2
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

# Ask the OS for a currently unused loopback port. The Postgres bind
# immediately afterwards is authoritative; if that races, fail safely.
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
"$BIN/initdb" -D "$PGDATA" -A trust -U test --no-instructions > "$WORKDIR/init.log"
"$BIN/pg_ctl" -D "$PGDATA" -o "-h 127.0.0.1 -p $PORT -k $WORKDIR/socket" -l "$WORKDIR/server.log" -w start > "$WORKDIR/start.log"
started=1

export DATABASE_URL="postgresql://test@localhost:${PORT}/appliance_desk_test"
export DIRECT_URL="$DATABASE_URL"
export CI=true
# Use CI's disposable test-only account fixtures, never inherited production logins.
export OWNER_EMAIL=ci-owner@example.test
export OWNER_PASSWORD='FixtureOnlyNotARealCredential123!'
export TEST_CUSTOMER_EMAIL=ci-customer@example.test
export TEST_CUSTOMER_PASSWORD='FixtureOnlyNotARealCredential123!'
export TEST_STAFF_EMAIL=ci-staff@example.test
export TEST_STAFF_PASSWORD='FixtureOnlyNotARealCredential123!'
# Never allow an inherited deployment setting to activate a real provider.
unset VERCEL VERCEL_ENV
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U test -d postgres -c 'CREATE DATABASE appliance_desk_test OWNER test;' > /dev/null

echo "Running against NEW localhost-only PostgreSQL on port $PORT (disposable appliance_desk_test)."
npm run db:migrate:deploy
npm run db:seed
if [ "$1" = "--all" ]; then
  shift
  npx vitest run "$@"
else
  npx vitest run "$@"
fi
