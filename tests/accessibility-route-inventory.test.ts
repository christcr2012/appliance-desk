import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCESSIBILITY_ROUTES,
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
});
