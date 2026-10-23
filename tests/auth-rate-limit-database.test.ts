import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

// The disposable CI database switches sign-in limits off for the browser tests. This test turns them back on for
// itself (by hiding the CI marker while the auth module loads) to prove the counter really lives in the database.
describe.skipIf(!enabled)("sign-in attempt limit is shared through the database", () => {
  let handler: (request: Request) => Promise<Response>;
  let prismaClient: typeof import("@/lib/prisma").prisma;
  const ip = "203.0.113." + (Math.floor(Math.random() * 200) + 20);

  beforeAll(async () => {
    vi.resetModules();
    const savedCi = process.env.CI;
    process.env.CI = "false";
    const authModule = await import("@/lib/auth");
    process.env.CI = savedCi;
    handler = authModule.auth.handler;
    prismaClient = (await import("@/lib/prisma")).prisma;
  });
  afterAll(async () => {
    await prismaClient.rateLimit.deleteMany({ where: { key: { contains: ip } } });
  });

  it("refuses after too many attempts from one address and stores the count in the table", async () => {
    const attempt = () => handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password-123" }),
    }));
    const statuses: number[] = [];
    for (let i = 0; i < 14; i += 1) statuses.push((await attempt()).status);
    expect(statuses).toContain(429);
    expect(statuses[0]).not.toBe(429);
    expect(await prismaClient.rateLimit.count({ where: { key: { contains: ip } } })).toBeGreaterThan(0);
  });
});
