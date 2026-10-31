import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { manualAccessibilityRoutes } from "../e2e/route-inventory";

// AR-10 final-sweep guards: the end state of the sweep must not quietly
// regress — every desk page stays on the kit registry, the deleted legacy
// components stay deleted, and the plain-words / kit allow-lists stay
// limited to reasoned legal and tax exceptions.

const root = process.cwd();

function deskPageFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return deskPageFiles(full);
    return entry.name === "page.tsx"
      ? [path.relative(root, full).replaceAll(path.sep, "/")]
      : [];
  });
}

describe("AR-10 sweep guards", () => {
  it("registers every desk page in migrated-pages.json, with no stale entries", () => {
    const registry = JSON.parse(
      fs.readFileSync(path.join(root, "docs/build-specs/migrated-pages.json"), "utf8"),
    ) as Array<string | { file: string }>;
    const registered = registry
      .map((entry) => (typeof entry === "string" ? entry : entry.file))
      .sort();
    // PORTAL-1 (spec section 7) registered the customer portal on the
    // same registry: every /account page except the feedback surface
    // (MCP-10a's pages, which register when that surface migrates).
    const portalOnDisk = deskPageFiles(path.join(root, "src/app/account")).filter(
      (file) => !file.includes("/feedback/"),
    );
    const onDisk = [
      ...deskPageFiles(path.join(root, "src/app/desk")),
      ...portalOnDisk,
    ].sort();
    expect(onDisk).toEqual(registered);
  });

  it("keeps the deleted legacy components and navigation models deleted", () => {
    const deleted = [
      "src/lib/desk-navigation.ts",
      "src/lib/desk-sections.ts",
      "src/components/global-search-box.tsx",
      "src/components/desk/section-tabs.tsx",
      "src/components/desk/section-tabs-nav.tsx",
      "src/components/desk/agreement-progress.tsx",
      "src/components/ui/app-shell.tsx",
      "src/components/ui/attention-list.tsx",
      "src/components/ui/day-timeline.tsx",
      "src/components/ui/visit-row.tsx",
    ];
    for (const file of deleted) {
      expect(fs.existsSync(path.join(root, file)), `${file} stays deleted`).toBe(false);
    }
  });

  it("keeps the kit-guard allow-list to legal or tax reasons only", () => {
    const allow = (
      JSON.parse(
        fs.readFileSync(path.join(root, "scripts/kit-guard-allowlist.json"), "utf8"),
      ) as { entries: Array<{ file: string; rule: number; reason: string }> }
    ).entries;
    for (const entry of allow) {
      expect(entry.reason.length).toBeGreaterThanOrEqual(15);
      expect(entry.reason, `${entry.file} must cite a legal or tax reason`).toMatch(
        /legal|tax/i,
      );
    }
  });

  it("keeps the owner-wording allow-list to legal or tax reasons only", () => {
    const allow = JSON.parse(
      fs.readFileSync(path.join(root, "scripts/owner-wording-allowlist.json"), "utf8"),
    ) as Array<{ file: string; phrase: string; reason: string }>;
    for (const entry of allow) {
      expect(entry.reason.length).toBeGreaterThanOrEqual(15);
      expect(entry.reason, `${entry.file} must cite a legal or tax reason`).toMatch(
        /legal|tax|irs|form/i,
      );
    }
  });

  it("keeps manual-only accessibility routes named-spec only, and none of them fixture-backed", () => {
    const reference = /(?:e2e|tests)\/[A-Za-z0-9._/-]+\.(?:spec|test)\.ts/g;
    for (const route of manualAccessibilityRoutes()) {
      const named = route.manualOnlyReason?.match(reference) ?? [];
      expect(named.length, `${route.path} names its covering spec`).toBeGreaterThan(0);
      expect(route.fixture, `${route.path} is not fixture-backed`).not.toContain("{");
    }
  });
});
