// V-1/V-3: marketing sentences live in the website content (the editor), never in page code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HARD_CODED = [
  "No long-term contract",
  "Delivered & installed",
  "We fix it, fast",
  "haul away your old unit",
  "Chris personally reviews every request",
  "never changes for you once you sign",
  "Good news: we deliver",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

describe("public pages hold no hard-coded marketing copy", () => {
  const files = [...sourceFiles("src/app/(public)"), ...sourceFiles("src/components/site")];
  it("finds the public page files", () => {
    expect(files.length).toBeGreaterThan(10);
  });
  for (const phrase of HARD_CODED) {
    it(`"${phrase}" is not written into any public page or component`, () => {
      expect(files.filter((file) => readFileSync(file, "utf8").includes(phrase))).toEqual([]);
    });
  }
});
