import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/books-nightly/route";

const before = {
  secret: process.env.CRON_SECRET,
  active: process.env.BOOKS_STRIPE_SYNC_ENABLED,
};
afterEach(() => {
  if (before.secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = before.secret;
  if (before.active === undefined) delete process.env.BOOKS_STRIPE_SYNC_ENABLED;
  else process.env.BOOKS_STRIPE_SYNC_ENABLED = before.active;
});
describe("K-3 guarded nighttime importer", () => {
  it("refuses unconfigured secret before touching Stripe or the database", async () => {
    delete process.env.CRON_SECRET;
    process.env.BOOKS_STRIPE_SYNC_ENABLED = "true";
    expect((await GET(new Request("https://example.test/api/cron/books-nightly"))).status).toBe(500);
  });
  it("rejects wrong authorization even while disabled", async () => {
    process.env.CRON_SECRET = "synthetic-test-secret";
    process.env.BOOKS_STRIPE_SYNC_ENABLED = "false";
    expect((await GET(new Request("https://example.test/api/cron/books-nightly"))).status).toBe(401);
  });
  it("stays safely inactive until the owner opts in", async () => {
    process.env.CRON_SECRET = "synthetic-test-secret";
    process.env.BOOKS_STRIPE_SYNC_ENABLED = "false";
    const response = await GET(new Request("https://example.test/api/cron/books-nightly",
      { headers: { authorization: "Bearer synthetic-test-secret" } }));
    expect(response.status).toBe(200);
    expect((await response.json()).outcome).toBe("PAUSED");
  });
});
