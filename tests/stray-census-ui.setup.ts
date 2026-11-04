// CI-STRAY-1 in-runner connection census — UI-project instrument (v3).
//
// WHY A SEPARATE UI INSTRUMENT: census v2 counted connects per file and
// printed one line at that file's teardown. In the one Actions run where
// the fault fired under v2 (run 41827247363, unit shard 2/3), the summary
// sampler saw exactly one test-database backend alive at the end and the
// pg 'end' callback threw in a browser-style (vmThreads) worker — yet no
// browser-style file printed a census line in any readable part of the
// log. V2's design can miss a connection whose owning context is already
// gone when the count would print, and log extraction gaps (rate-limited
// reads) can hide a single line. V3 therefore prints IN REAL TIME.
//
// This setup is wired only into the ui and ui-db projects (see
// vitest.config.mts). Browser-style files are not supposed to open pg
// connections at all, so real-time volume is expected to be zero; any
// STRAY-CENSUS CONNECT line naming a ui context is the smoking gun, and
// the paired CLIENT-CLOSE line (printed from the socket's own 'close'
// event, which still fires when pg's 'end' handler throws) names the
// owner of a connection at the moment it dies.
//
// Node-pool projects keep the lean v2 counter (tests/stray-census.setup.ts):
// they open hundreds of legitimate connections and real-time printing
// there would flood the log.
//
// ACTIVATION: same gate as v2 — STRAY_CENSUS=1 reaches the worker via
// vitest.config (env var or the diagnostic-branch marker). Inert
// otherwise. Never reads the bare `process` global.
//
// MECHANISM (established from vitest's vm worker source, 2026-11-04):
// the vmThreads worker installs `context.process = process` on a file's
// jsdom vm context before running it, then strips the globals it
// installed back out when that file's environment is torn down. A pg
// client created in the file's context keeps callbacks bound to that
// context's global — so a pooled connection that outlives its file
// throws "ReferenceError: process is not defined" (pg client.js, the
// connection-'end' handler's process.nextTick) when its socket finally
// ends, and vitest blames whatever file the worker is running then.

import { beforeAll, expect } from "vitest";

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
  // Bind the log function NOW: vitest strips the globals it installed
  // (process, console, ...) out of a file's vm context when that file's
  // environment is torn down — which is exactly why pg's connection-end
  // callback throws in a dead file's context. A close probe that looked
  // up `console` at print time could be stripped along with it; the
  // bound function keeps working.
  const censusLog = console.log.bind(console);
  let tag = "(import-phase)";
  beforeAll(() => {
    try {
      tag = expect.getState().testPath ?? tag;
    } catch {
      // Keep the import-phase tag; stacks still name the module chain.
    }
  });

  const pg = await import("pg");
  type ClientLike = {
    connect: (...args: unknown[]) => unknown;
    connection?: { stream?: { once: (event: string, fn: () => void) => void } };
  };
  const clientPrototype = pg.Client.prototype as unknown as ClientLike;
  const originalConnect = clientPrototype.connect;
  clientPrototype.connect = function patchedConnect(
    this: ClientLike,
    ...args: unknown[]
  ) {
    const stack = (new Error("stray-census connect trace").stack ?? "").replace(
      /\s*\n\s*/g,
      " | ",
    );
    censusLog(
      `STRAY-CENSUS CONNECT tag=${tag} at=${new Date().toISOString()} stack=${stack}`,
    );
    const client = this;
    const armCloseProbe = () => {
      try {
        client.connection?.stream?.once("close", () => {
          censusLog(
            `STRAY-CENSUS CLIENT-CLOSE tag=${tag} at=${new Date().toISOString()} connectStack=${stack}`,
          );
        });
      } catch {
        // Probing must never disturb the connection.
      }
    };
    if (typeof args[0] === "function") {
      const callback = args[0] as (error?: unknown) => void;
      args[0] = (error?: unknown) => {
        if (!error) armCloseProbe();
        callback(error);
      };
      return originalConnect.apply(this, args);
    }
    const result = originalConnect.apply(this, args) as Promise<unknown>;
    if (result && typeof result.then === "function") {
      void result.then(armCloseProbe, () => undefined);
    }
    return result;
  };
}
