import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESSIBILITY_ROUTES, MANUAL_ACCESSIBILITY_ROUTES } from "../e2e/route-inventory";

function pageFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? pageFiles(full) : entry.name === "page.tsx" ? [full] : [];
  });
}

function routeFromPage(file: string): string {
  const rel = path.relative(path.join(process.cwd(), "src/app"), file).replaceAll(path.sep, "/");
  const parts = rel
    .replace(/\/page\.tsx$/, "")
    .split("/")
    .filter((part) => part && !(part.startsWith("(") && part.endsWith(")")));
  return parts.length ? `/${parts.join("/")}` : "/";
}

describe("accessibility route inventory", () => {
  it("lists every App Router page exactly once", () => {
    const actual = pageFiles(path.join(process.cwd(), "src/app")).map(routeFromPage).sort();
    const declared = ACCESSIBILITY_ROUTES.map((route) => route.path).sort();
    expect(declared).toEqual(actual);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("documents every manual-only exception with a real reason and fixture shape", () => {
    for (const route of MANUAL_ACCESSIBILITY_ROUTES) {
      expect(route.manualOnlyReason?.trim().length).toBeGreaterThan(30);
      expect(route.fixture).toContain("/");
    }
  });

  it("keeps automated fixtures concrete or resolvable by the runner", () => {
    for (const route of ACCESSIBILITY_ROUTES.filter((entry) => !entry.manualOnlyReason)) {
      expect(route.fixture).not.toMatch(/__(ESTIMATE|LEAD|MAINTENANCE|NOTICE|PART|PO|SUPPLIER)_ID__/);
    }
  });
});
