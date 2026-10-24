import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/telecom-sync/route";

const before = {
  secret: process.env.CRON_SECRET,
  active: process.env.TELECOM_SYNC_ENABLED,
};
afterEach(() => {
  if (before.secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = before.secret;
  if (before.active === undefined) delete process.env.TELECOM_SYNC_ENABLED;
  else process.env.TELECOM_SYNC_ENABLED = before.active;
});
describe("COM-N phone usage sync cron", () => {
  it("refuses unconfigured secret before touching the phone company or the database", async () => {
    delete process.env.CRON_SECRET;
    process.env.TELECOM_SYNC_ENABLED = "true";
    expect((await GET(new Request("https://example.test/api/cron/telecom-sync"))).status).toBe(500);
  });
  it("rejects wrong authorization even while disabled", async () => {
    process.env.CRON_SECRET = "synthetic-test-secret";
    process.env.TELECOM_SYNC_ENABLED = "false";
    expect((await GET(new Request("https://example.test/api/cron/telecom-sync"))).status).toBe(401);
  });
  it("stays safely inactive until the owner opts in", async () => {
    process.env.CRON_SECRET = "synthetic-test-secret";
    process.env.TELECOM_SYNC_ENABLED = "false";
    const response = await GET(new Request("https://example.test/api/cron/telecom-sync",
      { headers: { authorization: "Bearer synthetic-test-secret" } }));
    expect(response.status).toBe(200);
    expect((await response.json()).outcome).toBe("PAUSED");
  });
});
