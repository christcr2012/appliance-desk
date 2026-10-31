import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

// AR-5 section 5: My route keeps a copy of today's route on the device; when the
// connection drops, AR-11's offline page shows that copy read-only — same person,
// same day — with no way to change anything.
const ownerState = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(ownerState)).toBe(true);
  test.skip(!fs.existsSync(ownerState), "Requires isolated CI owner fixture");
});

test("the saved route shows on the offline page, read-only", async ({ context, page }) => {
  test.skip(!enabled, "Disposable CI database only");
  const tag = randomUUID().slice(0, 8);
  const { prisma } = await import("../src/lib/prisma");
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });
  expect(owner).not.toBeNull();
  const customerUser = await prisma.user.create({
    data: { email: `ar5o-${tag}@example.test`, name: `AR5 Offline ${tag}`, role: "CUSTOMER", emailVerified: true },
  });
  const customer = await prisma.customer.create({
    data: { userId: customerUser.id, phone: "9705550142", referralCode: `O${tag}` },
  });
  const address = await prisma.serviceAddress.create({
    data: { customerId: customer.id, line1: "44 Offline Lane", city: "Greeley", state: "CO", zip: "80631" },
  });
  const job = await prisma.job.create({
    data: {
      type: "DELIVERY",
      status: "SCHEDULED",
      scheduledAt: new Date(),
      customerId: customer.id,
      serviceAddressId: address.id,
      assignedToUserId: owner!.id,
    },
  });

  try {
    await context.addInitScript(() => localStorage.setItem("desk-sw-test", "on"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/desk/driver");
    await expect(page.getByText(`AR5 Offline ${tag}`)).toBeVisible();

    // The page writes its on-device copy on render; wait until it is really there.
    // Never open the database from the probe itself: a bare open would create a
    // storeless v1 database before the page's own upgrade handler runs.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const infos = await indexedDB.databases();
          if (!infos.some((info) => info.name === "desk-route")) return false;
          return new Promise<boolean>((resolve) => {
            const request = indexedDB.open("desk-route", 1);
            request.onsuccess = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains("snapshot")) {
                db.close();
                return resolve(false);
              }
              const get = db.transaction("snapshot", "readonly").objectStore("snapshot").get("today");
              get.onsuccess = () => {
                const value = get.result as { stops?: unknown[] } | undefined;
                db.close();
                resolve(Boolean(value?.stops?.length));
              };
              get.onerror = () => resolve(false);
            };
            request.onerror = () => resolve(false);
          });
        }),
      )
      .toBe(true);

    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
      await page.reload();
      await expect(page.getByText(`AR5 Offline ${tag}`)).toBeVisible();
    }
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    // My route also warms the offline page while the connection is up (its
    // own scripts are only in the worker's cache once fetched online). Wait
    // until that warming has settled — the count of cached static files
    // holds steady across three reads — before simulating the drop, the
    // same precondition a real phone has after sitting on the route page.
    const cachedStaticCount = () =>
      page.evaluate(async () => {
        const cache = await caches.open("desk-shell-v1");
        return (await cache.keys()).filter((request) => request.url.includes("/_next/static/")).length;
      });
    let previousCount = -1;
    let stableReads = 0;
    await expect
      .poll(
        async () => {
          const count = await cachedStaticCount();
          stableReads = count === previousCount ? stableReads + 1 : 0;
          previousCount = count;
          return stableReads >= 2;
        },
        { intervals: [750, 750, 750] },
      )
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /Today's route \(saved/ })).toBeVisible();
    await expect(page.getByText(`AR5 Offline ${tag}`)).toBeVisible();
    await expect(page.getByText("Changes are paused until you're back online.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Directions" })).toBeVisible();
    await context.setOffline(false);
  } finally {
    await prisma.job.deleteMany({ where: { id: job.id } });
    await prisma.serviceAddress.deleteMany({ where: { id: address.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.user.deleteMany({ where: { id: customerUser.id } });
  }
});
