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

test("fleet estimates expose incomplete costs, supporting records and every paginated unit", async ({
  page,
}, info) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI owner only");
  test.setTimeout(120_000);
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID();
  const typeId = `fleet-type-${tag}`;
  const jobId = `fleet-repair-${tag}`;
  const ids = Array.from({ length: 26 }, (_, i) => `fleet-${tag}-${i}`);
  try {
    await prisma.applianceType.create({
      data: {
        id: typeId,
        name: "Fleet report fixture",
        slug: typeId,
        monthlyPriceCents: 3500,
      },
    });
    await prisma.appliance.createMany({
      data: ids.map((id, i) => ({
        id,
        assetNumber: `FLEET-${tag}-${String(i).padStart(2, "0")}`,
        applianceTypeId: typeId,
        acquisitionCostCents: i === 0 ? 10000 : null,
      })),
    });
    await prisma.job.create({
      data: {
        id: jobId,
        type: "MAINTENANCE_VISIT",
        status: "COMPLETED",
        completedAt: new Date(),
        partsCostCents: 1500,
        laborCostCents: null,
        appliances: { create: { applianceId: ids[0] } },
      },
    });
    // /desk/fleet streams its redirect to Equipment › Insights; the
    // initial navigation can surface as ERR_ABORTED even though the
    // redirect lands (the same streamed-redirect behavior AR-7a's
    // staff-refusal test tolerates). Tolerate the abort on goto, then
    // prove the settled URL and the page content as before.
    const gotoFleet = async () => {
      await page.goto("/desk/fleet?costs=missing").catch((err: unknown) => {
        if (!String(err).includes("ERR_ABORTED")) throw err;
      });
    };
    await gotoFleet();
    for (const width of [360, 768, 1440]) {
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(
          (mode) => localStorage.setItem("theme", mode),
          theme,
        );
        await gotoFleet();
        // AR-9: /desk/fleet redirects to Equipment › Insights, keeping the
        // page and costs params; the fleet report lives there now.
        await expect(page).toHaveURL(/\/desk\/inventory\/insights\?costs=missing/);
        await expect(
          page.getByRole("heading", { name: "All appliances: value and cost" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: /How to read these numbers/ })
          .click();
        await expect(
          page.getByText(
            /figures do not establish cash collected or business profit/,
          ),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Repairs missing a cost" }),
        ).toBeVisible();
        await expect(
          page.locator(`a[href="/desk/jobs/${jobId}"]:visible`).first(),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        await info.attach(`fleet-${width}-${theme}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      }
    }
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/costs=missing.*page=2/);
    await expect(
      page.locator("table").getByRole("link", {
        name: `FLEET-${tag}-25 — Fleet report fixture`,
        exact: true,
      }),
    ).toBeVisible();
    // Desktop rows open the kit side panel on this page (Codex P2 on
    // PR #747: the panel link used to land on a page that rendered no
    // panel, so desktop navigation went nowhere). The panel's full-page
    // link must reach the appliance record.
    await page
      .locator("table")
      .getByRole("link", {
        name: `FLEET-${tag}-25 — Fleet report fixture`,
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`open=${ids[25]}`));
    await expect(
      page.getByRole("link", { name: /Open full page/ }),
    ).toHaveAttribute("href", `/desk/inventory/${ids[25]}`);
    await page.goto(`/desk/inventory/${ids[0]}`);
    // AR-6: the earnings summary (with the incomplete-cost label and the
    // repair review links) lives on the record's Money tab now.
    await page
      .getByRole("navigation", { name: "Appliance sections" })
      .getByRole("link", { name: "Money", exact: true })
      .click();
    await expect(page).toHaveURL(/tab=money/);
    await expect(page.getByText("Unknown — costs incomplete")).toBeVisible();
    await expect(
      page.getByRole("link", { name: `Review repair ${jobId}`, exact: true }),
    ).toHaveAttribute("href", `/desk/jobs/${jobId}`);
    await page
      .getByRole("link", { name: `Review repair ${jobId}`, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/desk/jobs/${jobId}$`));
  } finally {
    await prisma.jobAppliance.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
  }
});
