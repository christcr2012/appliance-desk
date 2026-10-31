import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTAL_TRANSLATIONS } from "@/domains/language/portal-copy";

// A portal menu label with no Spanish word shows as a blank button to a Spanish-language customer
// (found when "Rentals" was missing). Every label in the portal menu must have a translation.
// PORTAL-1: the shell now keeps ONE label set for phone and desktop (ACCOUNT_LINKS, each label a
// portal dictionary key), so the labels are read from those entries instead of the old
// desktopLabel/mobileLabel pairs.
describe("portal menu labels are translated", () => {
  const source = readFileSync("src/components/account-shell.tsx", "utf8");
  const linksBlock = source.match(/const ACCOUNT_LINKS[^[]*\[([\s\S]*?)\];/)?.[1] ?? "";
  const labels = [...linksBlock.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]!);
  it("finds the menu labels", () => expect(labels.length).toBeGreaterThanOrEqual(5));
  it.each([...new Set(labels)])("%s has a Spanish translation", (label) => {
    expect((PORTAL_TRANSLATIONS as Record<string, string>)[label]?.length ?? 0).toBeGreaterThan(0);
  });
});
