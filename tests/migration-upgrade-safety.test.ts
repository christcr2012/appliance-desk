import { describe, expect, it } from "vitest";
import { migrationUpgradeTarget } from "../scripts/lib/migration-upgrade-safety";

const url = "postgresql://test:test@localhost:5432/appliance_desk_test";
const safe = { CI: "true", DATABASE_URL: url, DIRECT_URL: url };

it("accepts only the disposable CI target", () => {
  expect(migrationUpgradeTarget(safe).toString()).toBe(url);
});

describe("rejects before any database operation", () => {
  it.each([
    { CI: undefined },
    { CI: "false" },
    { VERCEL: "1" },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "production" },
    { DATABASE_URL: url + "?schema=public" },
    { DIRECT_URL: undefined },
    { DIRECT_URL: "not-a-url" },
    ...[
      "postgres://test:test@localhost:5432/appliance_desk_test",
      "postgresql://test:test@production.neon.tech:5432/appliance_desk_test",
      "postgresql://test:test@localhost:5433/appliance_desk_test",
      "postgresql://test:test@localhost:5432/appliance_desk",
      "postgresql://owner:secret@localhost:5432/appliance_desk_test",
      url + "?host=production.neon.tech",
      url + "#override",
    ].map((target) => ({ DIRECT_URL: target, DATABASE_URL: target })),
  ])("refuses unsafe configuration %#", (override) => {
    expect(() => migrationUpgradeTarget({ ...safe, ...override })).toThrow(
      /requires/,
    );
  });

  it("does not echo supplied credentials in errors", () => {
    expect.assertions(2);
    try {
      migrationUpgradeTarget({
        ...safe,
        DIRECT_URL:
          "postgresql://owner:private-password@live.neon.tech/production",
      });
    } catch (error) {
      expect(String(error)).not.toContain("private-password");
      expect(String(error)).not.toContain("live.neon.tech");
    }
  });
});
