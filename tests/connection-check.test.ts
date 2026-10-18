// F2-A connection check: every To do button and every Related-panel link must lead to a page that exists. Links are
// read from the source (domain code, desk pages, components) and matched against the real App Router page list, so a
// link to a missing page fails here before a person ever clicks it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageRoutes } from "../scripts/check-route-inventory.mjs";

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );

/** Every literal internal path used as a link target in a given source tree. */
export function linkTargets(roots: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (raw: string, file: string) => {
    const literal = raw.slice(1, -1);
    if (!literal.startsWith("/")) return;
    found.set(literal, [...(found.get(literal) ?? []), file]);
  };
  for (const root of roots) {
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/\bhref:\s*(`[^`]*`|"[^"]*")/g)) add(m[1], file);
      for (const m of source.matchAll(/\bL\(\s*"[^"]*",\s*[^,]+,\s*(`[^`]*`|"[^"]*")/g)) add(m[1], file);
      for (const m of source.matchAll(/\bhref=(?:(")(\/[^"]*)"|\{(`[^`]*`|"[^"]*")\})/g)) add(m[3] ?? `"${m[2]}"`, file);
    }
  }
  return found;
}

/** A target resolves when some page route matches its path segments ([id] is one segment, [...x] is one or more). */
export function resolves(target: string, routes: string[]): boolean {
  const path = target.split(/[?#]/)[0].replace(/\$\{[^}]*\}/g, "X");
  if (path === "/" || path === "") return true;
  const wanted = path.replace(/\/$/, "").split("/").slice(1);
  const prefix = path.endsWith("/") && path !== "/"; // "/desk/customers/" + id is built by concatenation
  return routes.some((route) => {
    const parts = route.split("/").slice(1);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith("[...") || parts[i].startsWith("[[...")) return wanted.length > i;
      if (i >= wanted.length) return prefix && i === wanted.length && parts.length === i + 1;
      if (!parts[i].startsWith("[") && parts[i] !== wanted[i]) return false;
    }
    return parts.length === wanted.length || (prefix && parts.length === wanted.length + 1);
  });
}

/** Download and API endpoints (route.ts) are valid link targets too. */
function handlerRoutes(appDir = join(process.cwd(), "src", "app")): string[] {
  return walk(appDir)
    .filter((file) => /[\\/]route\.ts$/.test(file))
    .map((file) => file.slice(appDir.length, -"/route.ts".length).split(/[\\/]/).filter((s) => !(s.startsWith("(") && s.endsWith(")"))).join("/"))
    .filter(Boolean);
}

describe("connection check: links lead to real pages", () => {
  const routes = [...(pageRoutes() as string[]), ...handlerRoutes()];

  it("matches routes the way the app does", () => {
    expect(resolves("/desk/jobs/${job.id}", routes)).toBe(true);
    expect(resolves("/desk/jobs/", routes)).toBe(true);
    expect(resolves("/desk/this-page-does-not-exist", routes)).toBe(false);
    expect(resolves("/desk/billing/customer/${c}/invoice/${i}?tab=x#top", routes)).toBe(true);
    expect(resolves("/desk/jobs/${job.id}/no-such-subpage", routes)).toBe(false);
  });

  it("every To do and Related link written in domain code resolves to a page", () => {
    const targets = linkTargets(["src/domains"]);
    expect(targets.size).toBeGreaterThan(30);
    const broken = [...targets].filter(([target]) => target.trim() !== "" && !resolves(target, routes)).map(([target, files]) => `${target} (${files[0]})`);
    expect(broken).toEqual([]);
  });

  it("every internal link on the desk, portal and shared components resolves to a page", () => {
    const targets = linkTargets(["src/app", "src/components"]);
    expect(targets.size).toBeGreaterThan(100);
    const broken = [...targets].filter(([target]) => target.trim() !== "" && !resolves(target, routes)).map(([target, files]) => `${target} (${files[0]})`);
    expect(broken).toEqual([]);
  });
});
