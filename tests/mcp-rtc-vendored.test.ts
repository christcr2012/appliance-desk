import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runConformance } from "./fixtures/rtc-upstream/src/run.js";
import { startFakeServer } from "./fixtures/rtc-upstream/fake-server/server.js";

const ORIGINAL_GIT_BLOBS: ReadonlyArray<readonly [string, string]> = [
  ["tests/fixtures/rtc-upstream/src/run.js", "d639dbfe37830a2901fa6addb5ff40e3c74d8b6d"],
  ["tests/fixtures/rtc-upstream/src/fixtures.js", "1ff39a314ea905649181206644fe30d3c4ccca29"],
  ["tests/fixtures/rtc-upstream/src/oauth.js", "76bbb98570d212295a8dedbbdf5a8408d915ef4d"],
  ["tests/fixtures/rtc-upstream/src/rate-limit.js", "3c935e43d3090b6c4e6fa809da6c08614fc08f04"],
  ["tests/fixtures/rtc-upstream/fake-server/server.js", "cdcbfd197247030be66083c1aa569a8969bc2d9c"],
  ["tests/fixtures/rtc-upstream/fake-server/instance.js", "8272f7790f3983ef9d775b3ad8bcfa57348c9396"],
  ["tests/fixtures/rtc-upstream/bin/rtc-conformance.js", "e82909889347603d3f13c81c25119a457ec8eedb"],
  ["tests/fixtures/rtc-upstream/package.json", "f6819945c7f91e3175ccdfaecf73eb7f040c9633"]
];

describe("MCP-9 pinned upstream RTC 1 conformance oracle", () => {
  it("is byte-for-byte the frozen e6cfb9826672 upstream runner, not a rewritten test", () => {
    for (const [path, expectedSha] of ORIGINAL_GIT_BLOBS) {
      const bytes = readFileSync(path);
      const actual = createHash("sha1").update("blob " + bytes.length + "\0")
        .update(bytes).digest("hex");
      expect(actual, path).toBe(expectedSha);
    }
  });
  it("validates real HTTP responses from the upstream reference server, but never certifies skipped probes", async () => {
    const fake = await startFakeServer();
    try {
      const result = await runConformance({ url: fake.url, passes: fake.passes, oauth: fake.oauth });
      const byName = new Map(result.checks.map((check: { name: string; ok: boolean; skipped?: boolean }) => [check.name, check]));
      expect(byName.get("manifest")?.ok).toBe(true);
      expect(byName.get("catalog")?.ok).toBe(true);
      expect(byName.get("writes")?.ok).toBe(true);
      expect(byName.get("passes.read_only")?.ok).toBe(true);
      expect(byName.get("limits.two_instance")?.skipped).toBe(true);
      expect(result.ok).toBe(false); // a skipped two-instance probe is never a pass
    } finally { await fake.close(); }
  }, 30_000);
  it("detects a deliberately unsafe read-only pass write in the pinned upstream reference", async () => {
    const broken = await startFakeServer({ faults: ["read-only-pass-can-write"] });
    try {
      const result = await runConformance({ url: broken.url, passes: broken.passes, oauth: broken.oauth });
      expect(result.ok).toBe(false);
      const violation = result.checks.find((check: { name: string }) => check.name === "passes.read_only");
      expect(violation?.ok).toBe(false);
      expect(violation?.skipped).not.toBe(true);
    } finally { await broken.close(); }
  }, 30_000);
});
