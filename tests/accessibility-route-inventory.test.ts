import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCESSIBILITY_ROUTES,
  FIXTURE_KEYS,
  manualAccessibilityRoutes,
} from "../e2e/route-inventory";

function pageFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

function routeFromPage(file: string) {
  const relative = path
    .relative(path.join(process.cwd(), "src", "app"), file)
    .replaceAll(path.sep, "/")
    .replace(/\/page\.tsx$/, "");
  const segments = relative
    .split("/")
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  return segments.length ? `/${segments.join("/")}` : "/";
}

describe("accessibility route inventory", () => {
  it("lists every App Router page exactly once", () => {
    const discovered = pageFiles(path.join(process.cwd(), "src", "app"))
      .map(routeFromPage)
      .sort();
    const inventoried = ACCESSIBILITY_ROUTES.map((route) => route.path).sort();

    expect(new Set(inventoried).size).toBe(inventoried.length);
    expect(inventoried).toEqual(discovered);
  });

  it("requires an explicit reason and fixture for every manual-only route", () => {
    for (const route of manualAccessibilityRoutes()) {
      expect(route.fixture.trim().length).toBeGreaterThan(10);
      expect(route.manualOnlyReason?.trim().length).toBeGreaterThan(20);
    }
  });

  it("gives every automated route a concrete URL", () => {
    for (const route of ACCESSIBILITY_ROUTES.filter((item) => !item.manualOnlyReason)) {
      expect(route.fixture.startsWith("/")).toBe(true);
    }
  });

  it("AR-10: every manual-only route names the spec or test that covers it, and that file exists", () => {
    const reference = /(?:e2e|tests)\/[A-Za-z0-9._/-]+\.(?:spec|test)\.ts/g;
    for (const route of manualAccessibilityRoutes()) {
      const named = route.manualOnlyReason?.match(reference) ?? [];
      expect(
        named.length,
        `${route.path} must name its covering spec in its manual-only reason`,
      ).toBeGreaterThan(0);
      for (const file of named) {
        expect(
          fs.existsSync(path.join(process.cwd(), file)),
          `${route.path} names ${file}, which must exist`,
        ).toBe(true);
      }
    }
  });

  it("AR-10: fixture id references use only the keys global setup writes", () => {
    for (const route of ACCESSIBILITY_ROUTES) {
      for (const match of route.fixture.matchAll(/\{(\w+)\}/g)) {
        expect(
          (FIXTURE_KEYS as readonly string[]).includes(match[1]),
          `${route.path} references unknown fixture key ${match[1]}`,
        ).toBe(true);
      }
    }
  });
});
