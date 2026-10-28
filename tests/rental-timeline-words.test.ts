import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RENTAL_EVENT_WORDS } from "@/domains/agreements/timeline";

// AR-4a / RENTALS spec section 3: the timeline words map is exhaustive for
// the agreement.* audit keys the code writes today. The settings keys
// (ending_notice_days / unsigned_follow_up_days / end_reasons) are settings
// rows, never rental rows, so they are excluded on purpose.
const EXCLUDED = new Set([
  "agreement.ending_notice_days.update",
  "agreement.unsigned_follow_up_days.update",
  "agreement.end_reasons.update",
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(entry)) yield path;
  }
}

describe("RENTAL_EVENT_WORDS coverage", () => {
  it("covers every agreement.* action literal in src/domains and src/app", { timeout: 30_000 }, () => {
    const found = new Set<string>();
    for (const root of ["src/domains", "src/app"]) {
      for (const file of walk(join(process.cwd(), root))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/"agreement\.([a-z_]+(?:\.[a-z_]+)?)"/g)) {
          found.add(`agreement.${match[1]}`);
        }
      }
    }
    const missing = [...found].filter(
      (key) => !EXCLUDED.has(key) && !(key in RENTAL_EVENT_WORDS),
    );
    expect(missing).toEqual([]);
  });
});
