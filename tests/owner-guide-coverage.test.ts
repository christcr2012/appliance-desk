// F2-C (WU-F6): the owner guide stays complete and honest - every desk screen is named, every picture exists, every screen
// section carries the three things the owner needs, and a guide missing any of them is reported.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageRoutes } from "../scripts/check-route-inventory.mjs";

export const SCREEN_SECTIONS = [
  "Today and To do", "Leads", "Customers", "Estimates and phone orders", "Rentals (agreements)", "Visits, dispatch and the driver view",
  "Maintenance requests", "Inventory, parts, purchases and suppliers", "Billing, deposits and statements", "Taxes",
  "Reports, revenue, fleet and growth", "Notices, messages and automations", "Settings", "Website editor", "Launch list",
  "Backup, restore and privacy", "The customer portal", "The public website",
];

export function deskSections(routes: string[]): string[] {
  return [...new Set(routes.filter((r) => r.startsWith("/desk/")).map((r) => `/desk/${r.split("/")[2]}`))].sort();
}

export function problemsWith(guide: string, sections: string[], routes: string[], fileExists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  for (const section of deskSections(routes)) if (!guide.includes(`\`${section}\``)) problems.push(`desk screen ${section} is not named`);
  for (const base of ["/account", "/login"]) if (!guide.includes(`\`${base}\``)) problems.push(`${base} is not named`);
  for (const image of [...guide.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]) {
    if (!fileExists(`docs/${image[1]}`)) problems.push(`picture ${image[1]} is missing`);
    if (!/!\[[^\]]+\]/.test(image[0])) problems.push(`picture ${image[1]} has no alt text`);
  }
  for (const heading of sections) {
    const start = guide.indexOf(`\n## ${heading}\n`);
    if (start < 0) { problems.push(`section "${heading}" is missing`); continue; }
    const rest = guide.slice(start + 1);
    const end = rest.indexOf("\n## ", 3);
    const body = end < 0 ? rest : rest.slice(0, end);
    if (!body.includes("**What it's for.**")) problems.push(`"${heading}" has no What it's for`);
    if (!body.includes("**Change without code.**") && !["Launch list", "Backup, restore and privacy", "The customer portal"].includes(heading)) problems.push(`"${heading}" has no Change without code`);
    if (!/\*\*If (it|a save or automation) fails\.\*\*/.test(body)) problems.push(`"${heading}" has no failure guidance`);
  }
  return problems;
}

describe("owner guide coverage", () => {
  const guide = readFileSync("docs/OWNER-GUIDE.md", "utf8");
  const routes = pageRoutes() as string[];

  it("names every desk screen, shows only pictures that exist and gives every screen its three parts", () => {
    expect(problemsWith(guide, SCREEN_SECTIONS, routes, existsSync)).toEqual([]);
  });
  it("embeds at least the ten core screenshots that the screenshot spec writes", () => {
    const shots = [...guide.matchAll(/\]\((owner-guide\/screenshots\/[\w-]+\.png)\)/g)].map((m) => m[1]);
    expect(shots.length).toBeGreaterThanOrEqual(10);
    for (const shot of shots) expect(existsSync(`docs/${shot}`)).toBe(true);
    const spec = readFileSync("e2e/owner-guide-screenshots.spec.ts", "utf8");
    for (const shot of shots) expect(spec).toContain(shot.split("/").pop()!);
  });
  it("keeps the screenshot spec skipped unless OWNER_GUIDE_SHOTS=1 and registered in a shard", () => {
    const spec = readFileSync("e2e/owner-guide-screenshots.spec.ts", "utf8");
    expect(spec).toContain('process.env.OWNER_GUIDE_SHOTS === "1"');
    expect(readFileSync("e2e/shards.json", "utf8")).toContain("owner-guide-screenshots.spec.ts");
  });
  it("reports a missing screen, a missing picture and a section without failure guidance", () => {
    expect(problemsWith(guide.replace("`/desk/fleet`", "fleet"), SCREEN_SECTIONS, routes, existsSync)).toContain("desk screen /desk/fleet is not named");
    expect(problemsWith(guide, SCREEN_SECTIONS, routes, () => false).some((p) => p.startsWith("picture "))).toBe(true);
    expect(problemsWith(guide.replace(/\*\*If it fails\.\*\*/g, "**Oops.**"), SCREEN_SECTIONS, routes, existsSync).some((p) => p.includes("no failure guidance"))).toBe(true);
    expect(problemsWith(guide.replace("\n## Taxes\n", "\n## Tax\n"), SCREEN_SECTIONS, routes, existsSync)).toContain('section "Taxes" is missing');
  });
  it("does not carry the superseded weekly-release or handoff instructions", () => {
    expect(guide).not.toMatch(/Monday at about 3 a\.m\./);
    expect(guide).not.toMatch(/HANDOFF-2026-09-26/);
  });
});
