import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Real-database tests that write records existing once for the whole database (the business-settings row) or create
// Colorado filing accounts (read across all rows by reminders, the tax overview and the health sweep) must run one at a
// time, in vitest.config.mts's shared-settings project. Running them in parallel made them fail by chance.
const SHARED_WRITE = /businessSettings\.(update|upsert|updateMany)|UPDATE "BusinessSettings"|taxFilingAccount\.(create|createMany|upsert)/;
const REAL_DATABASE = /appliance_desk_test/;

describe("tests that write shared database records run one at a time", () => {
  it("every such real-database test is listed in the serial project", () => {
    const config = readFileSync("vitest.config.mts", "utf8");
    const missing = readdirSync("tests")
      .filter((name) => name.endsWith(".test.ts") && name !== "shared-state-tests-listed.test.ts")
      .map((name) => `tests/${name}`)
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return REAL_DATABASE.test(source) && SHARED_WRITE.test(source) && !config.includes(`"${path}"`);
      });
    expect(missing, "add these to SHARED_SETTINGS_TESTS in vitest.config.mts").toEqual([]);
  });
});
