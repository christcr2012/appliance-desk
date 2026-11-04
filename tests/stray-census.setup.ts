// CI-STRAY-1 in-runner connection census — per-worker instrument.
//
// WHY THIS EXISTS: the required unit job intermittently fails with every test
// passing, on 2–3 unhandled errors: `ReferenceError: process is not defined`
// at pg/lib/client.js:226. That is the pg driver's connection-end callback
// (it calls process.nextTick) running inside a browser-style (vmThreads)
// worker context, which has no Node `process` global. The file the error is
// blamed on is the victim — whichever file that worker is running when a
// stray connection finally closes. The opener is the file whose code opened
// the connection and left it open. Local hunts (per-file census, whole ui
// project serially, exact shard-2 shape on a VM and on a clean bench) never
// reproduced it; it fires only in GitHub's runners. This instrument therefore
// runs inside the CI run itself: it patches pg's Client.connect in every
// worker, records the creating stack and the test file active at connect
// time, logs closes with their age, and at each file's teardown names any
// connection that file opened and never closed.
//
// ACTIVATION: inert unless STRAY_CENSUS=1 reaches the worker (vitest.config
// sets it from the STRAY_CENSUS env var, or from the scripts/stray-census.ACTIVE
// marker that exists only on the diagnostic branch). This file never changes
// what a test does; it only observes pg client connections.
//
// NOTE: never read the bare `process` global here — in the vmThreads context
// that global does not exist (that absence IS the fault). Activation arrives
// via import.meta.env, which vitest populates in every pool.

import { afterAll, beforeEach, expect } from "vitest";

type CensusConnection = {
  bornAt: number;
  stack: string;
  file: string;
  closedAt?: number;
};

const importMetaEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;
const processEnv = (
  globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;
const censusActive =
  importMetaEnv?.STRAY_CENSUS === "1" || processEnv?.STRAY_CENSUS === "1";

if (censusActive) {
  const registry = new Set<CensusConnection>();
  let currentFile = "(import time)";

  beforeEach(() => {
    try {
      currentFile = expect.getState().testPath ?? currentFile;
    } catch {
      // No test state yet (module import): keep the last known file; the
      // connect stack below still names the importing module chain.
    }
  });

  afterAll(async () => {
    // Brief grace: a connection this file closed properly in teardown can
    // deliver its 'end' event a few milliseconds after afterAll begins; a
    // genuinely stray (pooled, idle) connection will not close in this
    // window, so the report below stays specific to real strays. Any
    // STILL-OPEN line should still be cross-checked against the CLOSE lines
    // in the run log before it is treated as a conviction.
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const conn of registry) {
      if (!conn.closedAt && conn.file === currentFile) {
        console.log(
          `STRAY-CENSUS STILL-OPEN file=${conn.file} ageMs=${Date.now() - conn.bornAt}\n${conn.stack}`,
        );
      }
    }
  });

  const pg = await import("pg");
  const clientPrototype = pg.Client.prototype as unknown as {
    connect: (...args: unknown[]) => unknown;
  };
  const originalConnect = clientPrototype.connect;
  clientPrototype.connect = function patchedConnect(...args: unknown[]) {
    const self = this as unknown as {
      once: (event: string, listener: () => void) => void;
    };
    const record: CensusConnection = {
      bornAt: Date.now(),
      stack: new Error("stray-census connect trace").stack ?? "",
      file: currentFile,
    };
    registry.add(record);
    console.log(
      `STRAY-CENSUS CONNECT file=${record.file}\n${record.stack}`,
    );
    self.once("end", () => {
      record.closedAt = Date.now();
      console.log(
        `STRAY-CENSUS CLOSE file=${record.file} ageMs=${record.closedAt - record.bornAt}`,
      );
    });
    return originalConnect.apply(this, args);
  };
}
