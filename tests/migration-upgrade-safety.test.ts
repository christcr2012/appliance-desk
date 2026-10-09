import { describe, expect, it } from "vitest";
import { migrationUpgradeTarget } from "../scripts/lib/migration-upgrade-safety";

const url = "postgresql://test:test@localhost:5432/appliance_desk_test";
const safe = { CI: "true", DATABASE_URL: url, DIRECT_URL: url };

it("accepts only the disposable CI target", () => {
  expect(migrationUpgradeTarget(safe).toString()).toBe(url);
});

it("accepts only explicitly launcher-owned nonstandard loopback ports", () => {
  const local = url.replace(":5432/", ":28743/");
  expect(migrationUpgradeTarget({
    ...safe, DIRECT_URL: local, DATABASE_URL: local, APPLIANCE_DESK_DISPOSABLE_PG: "true",
  }).toString()).toBe(local);
  expect(() => migrationUpgradeTarget({
    ...safe, DIRECT_URL: local, DATABASE_URL: local,
  })).toThrow(/requires/);
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

  it("does not let the sandbox flag bypass localhost, fixed test database or user", () => {
    for (const unsafe of [
      "postgresql://test:test@production.neon.tech:28743/appliance_desk_test",
      "postgresql://test:test@localhost:28743/production",
      "postgresql://owner:test@localhost:28743/appliance_desk_test",
      "postgresql://test:test@localhost:1023/appliance_desk_test",
    ]) {
      expect(() => migrationUpgradeTarget({
        ...safe, DIRECT_URL: unsafe, DATABASE_URL: unsafe,
        APPLIANCE_DESK_DISPOSABLE_PG: "true",
      })).toThrow(/requires/);
    }
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
