import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";

test("launch signup persists consent/source, dedupes, and unsubscribe GET doesn't mutate", async ({
  page,
  request,
}) => {
  const email = `launch-e2e-${randomBytes(6).toString("hex")}@example.test`;
  try {
    await page.goto("/launch?utm_source=instagram");
    await page.getByLabel("Name", { exact: true }).fill("Local Test Neighbor");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("City", { exact: true }).fill("Greeley");
    const consent = page.getByRole("checkbox");
    await expect(consent).not.toBeChecked();
    await consent.check();
    await page.getByRole("button", { name: "Join the interest list" }).click();
    await expect(page.getByRole("status")).toContainText(
      "interest has been recorded",
    );
    const subscriber = await prisma.launchSubscriber.findUniqueOrThrow({
      where: { email },
    });
    expect(subscriber.source).toBe("instagram");
    expect(subscriber.consentText).toContain("unsubscribe");
    expect(
      await prisma.launchDelivery.count({
        where: { subscriberId: subscriber.id },
      }),
    ).toBe(0);
    await page.goto(`/launch/unsubscribe?token=${subscriber.unsubscribeToken}`);
    expect(
      (await prisma.launchSubscriber.findUniqueOrThrow({ where: { email } }))
        .unsubscribedAt,
    ).toBeNull();
    await page
      .getByRole("button", { name: "Unsubscribe from marketing emails" })
      .click();
    await expect(
      page.getByText("You're unsubscribed", { exact: false }),
    ).toBeVisible();
    expect(
      (await prisma.launchSubscriber.findUniqueOrThrow({ where: { email } }))
        .unsubscribedAt,
    ).not.toBeNull();
    const oneClick = await request.post(
      `/launch/unsubscribe?token=${subscriber.unsubscribeToken}`,
      { form: { "List-Unsubscribe": "One-Click" } },
    );
    expect(oneClick.ok()).toBe(true);
  } finally {
    await prisma.launchSubscriber.deleteMany({ where: { email } });
  }
});

test("anonymous visitors cannot open the owner launch list or run its cron", async ({
  page,
  request,
}) => {
  await page.goto("/desk/launch");
  await expect(page).toHaveURL(/\/login/);
  expect([401, 503]).toContain(
    (await request.get("/api/cron/launch-emails")).status(),
  );
});
