import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test("Colorado day/week/agenda retain scheduled jobs and checklist progress after reload", async ({
  page,
}, info) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID();
  const ids = ["scheduled", "adjacent", "unscheduled"].map(
    (kind) => `dispatch-${tag}-${kind}`,
  );
  try {
    await prisma.job.createMany({
      data: ids.map((id, i) => ({
        id,
        type: "MAINTENANCE_VISIT",
        status: "SCHEDULED",
        scheduledAt:
          i === 0
            ? new Date("2026-11-01T06:30:00Z")
            : i === 1
              ? new Date("2026-11-01T05:30:00Z")
              : null,
        // AR-5: the waiting list shows the 50 longest-waiting visits, so the unscheduled
        // fixture is backdated to stay first in line on the shared CI database.
        createdAt: i === 2 ? new Date("2020-06-01T00:00:00Z") : undefined,
        checklist: [{ item: "CI dispatch persisted check", checked: false }],
      })),
    });
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/desk/dispatch?view=day&date=2026-11-01");
    // AR-5: a board row is an <li> whose stretched link points at the visit record.
    const row = (id: string) =>
      page.locator("li", { has: page.locator(`a[href="/desk/jobs/${id}"]`) });
    const visible = row(ids[0]);
    await expect(visible).toContainText("12:30 AM MDT");
    await expect(visible).toContainText("Double-booked");
    await expect(page.locator(`a[href="/desk/jobs/${ids[1]}"]`)).toHaveCount(0);
    // The waiting card opens itself when the waiting list is short; when it starts
    // closed (or a re-render closes it), open it by hand — retrying the toggle until
    // the row is actually visible, since one click can race the board's re-render.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await row(ids[2]).isVisible().catch(() => false)) break;
      await page.getByText(/Waiting for a time/).click();
      await page.waitForTimeout(300);
    }
    await expect(row(ids[2])).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await info.attach("colorado-dispatch-phone", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    for (const view of ["week", "agenda"]) {
      await page.goto(`/desk/dispatch?view=${view}&date=2026-11-01`);
      await expect(row(ids[0])).toContainText("12:30 AM MDT");
      await expect(page.locator(`a[href="/desk/jobs/${ids[1]}"]`)).toHaveCount(
        0,
      );
    }
    await page.goto(`/desk/jobs/${ids[0]}`);
    await page
      .getByRole("checkbox", {
        name: "CI dispatch persisted check",
        exact: true,
      })
      .check();
    await expect(
      page.getByRole("heading", { name: "Checklist (1/1)" }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await prisma.job.findUniqueOrThrow({ where: { id: ids[0] } }))
            .checklist,
      )
      .toEqual([{ item: "CI dispatch persisted check", checked: true }]);
    await page.reload();
    await expect(
      page.getByRole("checkbox", {
        name: "CI dispatch persisted check",
        exact: true,
      }),
    ).toBeChecked();
    await page.goto("/desk/dispatch?view=day&date=2026-11-01");
    await expect(row(ids[0])).toContainText("Checklist: 1/1");
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.job.deleteMany({ where: { id: { in: ids } } });
  }
});
