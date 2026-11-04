// CI-STRAY-1 in-runner connection census — per-worker instrument (v2, lean).
//
// WHY THIS EXISTS: the required unit job intermittently fails with every test
// passing, on 2–3 unhandled errors: `ReferenceError: process is not defined`
// at pg/lib/client.js:226. That is the pg driver's connection-end callback
// (it calls process.nextTick) running inside a browser-style (vmThreads)
// worker context, which has no Node `process` global. The file the error is
// blamed on is the victim — whichever file that worker is running when a
// stray connection finally closes. The opener is the file whose code opened
// the connection and left it pooled. Local hunts never reproduced the fault;
// it fires only in GitHub's runners, so the census runs there too.
//
// V2 IS DELIBERATELY LEAN. V1 logged a full stack for every connection plus
// every close, which tripled the job log (~1.06M chars vs ~300k) and dragged
// worker I/O enough to plausibly calm the very race being hunted (two
// census runs passed without the fault firing, after four straight firings
// without it). V2 emits exactly ONE line per test file that opened at least
// one pg connection, printed at that file's teardown:
//
//   STRAY-CENSUS FILE file=<path> connects=<n> firstStack=<one-line stack>
//
// Any such line naming a browser-style (.tsx / ui project) file is the
// smoking gun: ui files are not supposed to open connections at all, and the
// first stack names the code path that did it. Connection lifetimes and
// closes are covered out-of-process by the pg_stat_activity sampler in
// scripts/stray-census-global.mjs, which adds no load inside the workers.
//
// ACTIVATION: inert unless STRAY_CENSUS=1 reaches the worker (vitest.config
// sets it from the STRAY_CENSUS env var, or from the scripts/stray-census.ACTIVE
// marker that exists only on the diagnostic branches). This file never
// changes what a test does; it only counts pg client connections.
//
// NOTE: never read the bare `process` global here — in the vmThreads context
// that global does not exist (that absence IS the fault). Activation arrives
// via import.meta.env, which vitest populates in every pool.

import { afterAll, beforeAll, expect } from "vitest";

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
  let currentFile = "(unknown file)";
  let connects = 0;
  let firstStack = "";

  beforeAll(() => {
    try {
      currentFile = expect.getState().testPath ?? currentFile;
    } catch {
      // No test state yet; the stack below still names the module chain.
    }
  });

  afterAll(() => {
    if (connects > 0) {
      console.log(
        `STRAY-CENSUS FILE file=${currentFile} connects=${connects} firstStack=${firstStack.replace(/\s*\n\s*/g, " | ")}`,
      );
    }
  });

  const pg = await import("pg");
  const clientPrototype = pg.Client.prototype as unknown as {
    connect: (...args: unknown[]) => unknown;
  };
  const originalConnect = clientPrototype.connect;
  clientPrototype.connect = function patchedConnect(...args: unknown[]) {
    connects += 1;
    if (!firstStack) {
      firstStack = new Error("stray-census connect trace").stack ?? "";
    }
    return originalConnect.apply(this, args);
  };
}
