import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTAL_TRANSLATIONS } from "@/domains/language/portal-copy";

// A portal menu label with no Spanish word shows as a blank button to a Spanish-language customer
// (found when "Rentals" was missing). Every label in the portal menu must have a translation.
describe("portal menu labels are translated", () => {
  const source = readFileSync("src/components/account-shell.tsx", "utf8");
  const labels = [...source.matchAll(/(?:desktopLabel|mobileLabel):\s*"([^"]+)"/g)].map((m) => m[1]!);
  it("finds the menu labels", () => expect(labels.length).toBeGreaterThanOrEqual(10));
  it.each([...new Set(labels)])("%s has a Spanish translation", (label) => {
    expect((PORTAL_TRANSLATIONS as Record<string, string>)[label]?.length ?? 0).toBeGreaterThan(0);
  });
});
