// CI-STRAY-1 in-runner connection census — main-process instrument.
//
// Companion to tests/stray-census.setup.ts (which patches pg inside each
// test worker and names the file/stack that opened a connection). This
// globalSetup runs in vitest's main process, where a real Node `process`
// exists, and independently watches the CI Postgres from the database side:
// it polls pg_stat_activity for EVERY database (v3: the stray may not be
// on the test database at all) and records every backend's server-side
// backend_start. At teardown it prints a summary — how many distinct backends existed, which ones lived long enough to cross
// test-file boundaries (a pooled connection's idle close is the suspected
// stray), and which were still alive when the run ended (those close during
// worker shutdown — the exact moment the fault's errors cluster).
//
// Inert unless the census is active: STRAY_CENSUS=1 in the environment, or
// the scripts/stray-census.ACTIVE marker file (present only on the
// diagnostic branch). It only ever SELECTs from pg_stat_activity on the
// throwaway CI database; it changes nothing about the run.
//
// vitest may invoke globalSetup once per project in the same main process,
// so the sampler is a refcounted singleton on globalThis: the first setup
// starts it, the last teardown stops it and prints the summary once.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "__strayCensusSampler";

function censusActive() {
  return (
    process.env.STRAY_CENSUS === "1" ||
    existsSync(resolve(root, "scripts/stray-census.ACTIVE"))
  );
}

export async function setup() {
  if (!censusActive()) return;
  const existing = globalThis[KEY];
  if (existing) {
    existing.refs += 1;
    return;
  }
  const state = {
    refs: 1,
    startedAt: Date.now(),
    backends: new Map(), // pid -> { firstSeen, lastSeen, backendStart, applicationName, state }
    timer: null,
    client: null,
    polling: false,
  };
  globalThis[KEY] = state;
  try {
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = "/postgres";
    state.client = new Client({ connectionString: url.toString() });
    await state.client.connect();
    const poll = async () => {
      if (state.polling || !state.client) return;
      state.polling = true;
      try {
        const { rows } = await state.client.query(
          "SELECT pid, datname, application_name, backend_start, state FROM pg_stat_activity WHERE pid <> pg_backend_pid()",
        );
        const now = Date.now();
        const seen = new Set();
        for (const row of rows) {
          seen.add(row.pid);
          const rec = state.backends.get(row.pid);
          if (rec) {
            rec.lastSeen = now;
            rec.state = row.state;
          } else {
            state.backends.set(row.pid, {
              firstSeen: now,
              lastSeen: now,
              backendStart: row.backend_start,
              datname: row.datname,
              applicationName: row.application_name,
              state: row.state,
            });
          }
        }
        for (const [pid, rec] of state.backends) {
          if (!seen.has(pid) && !rec.goneAt) rec.goneAt = now;
        }
      } catch {
        // The throwaway database is dropped/recreated by some suites; a
        // failed poll is a gap in the sample, never a run failure.
      } finally {
        state.polling = false;
      }
    };
    await poll();
    state.timer = setInterval(poll, 100);
    state.timer.unref?.();
    console.log("STRAY-CENSUS sampler started (pg_stat_activity, 100 ms)");
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message ||
          error.errors?.[0]?.message ||
          error.code ||
          error.name
        : String(error);
    console.log(`STRAY-CENSUS sampler unavailable: ${detail}`);
  }
}

export async function teardown() {
  const state = globalThis[KEY];
  if (!state) return;
  state.refs -= 1;
  if (state.refs > 0) return;
  delete globalThis[KEY];
  if (state.timer) clearInterval(state.timer);
  const endedAt = Date.now();
  const rows = [...state.backends.entries()].map(([pid, rec]) => ({
    pid,
    datname: rec.datname || "(none)",
    applicationName: rec.applicationName || "(none)",
    // Lifetime is measured from the server's own backend_start, so a
    // sampler poll that was starved near teardown cannot make a
    // long-lived backend look newborn.
    lifetimeMs:
      (rec.goneAt ?? rec.lastSeen) - new Date(rec.backendStart).getTime(),
    aliveAtEnd: !rec.goneAt,
    state: rec.state,
  }));
  const longLived = rows.filter((r) => r.lifetimeMs > 8000);
  const aliveAtEnd = rows.filter((r) => r.aliveAtEnd);
  const otherDb = rows.filter((r) => r.datname !== "appliance_desk_test");
  console.log(
    `STRAY-CENSUS-SUMMARY runMs=${endedAt - state.startedAt} distinctBackends=${rows.length} longLivedOver8s=${longLived.length} aliveAtEnd=${aliveAtEnd.length} otherDb=${otherDb.length}`,
  );
  for (const r of longLived) {
    console.log(
      `STRAY-CENSUS-SUMMARY long-lived pid=${r.pid} db=${r.datname} app=${r.applicationName} lifetimeMs=${r.lifetimeMs} aliveAtEnd=${r.aliveAtEnd} lastState=${r.state}`,
    );
  }
  for (const r of aliveAtEnd) {
    console.log(
      `STRAY-CENSUS-SUMMARY alive-at-end pid=${r.pid} db=${r.datname} app=${r.applicationName} lifetimeMs=${r.lifetimeMs} lastState=${r.state}`,
    );
  }
  for (const r of otherDb) {
    console.log(
      `STRAY-CENSUS-SUMMARY other-db pid=${r.pid} db=${r.datname} app=${r.applicationName} lifetimeMs=${r.lifetimeMs} aliveAtEnd=${r.aliveAtEnd} lastState=${r.state}`,
    );
  }
  try {
    await state.client?.end();
  } catch {
    // Sampler cleanup must never fail the run.
  }
}
