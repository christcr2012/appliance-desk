import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { enabled, SIZES } from "./support/ar0b-fixtures";

// AR-4d (QUOTES-MESSAGES spec section 4): the Quotes list and Messages
// inbox in a real browser — tabs and pills, search by quote number, the
// Make-it-a-rental anchor, the inbox's plain words, staff scoping, and
// linking an unknown number to a person from the thread page.
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";

function rowNamed(page: Page, name: string) {
  return page.locator("main tr:visible, main li:visible").filter({ hasText: name });
}

async function ownerId(): Promise<string> {
  const { prisma } = await import("../src/lib/prisma");
  const user = await prisma.user.findFirst({
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return user!.id;
}

async function staffId(): Promise<string> {
  const { prisma } = await import("../src/lib/prisma");
  const user =
    (await prisma.user.findFirst({
      where: { role: "STAFF", email: { startsWith: "ci-staff" } },
      select: { id: true },
    })) ??
    (await prisma.user.findFirst({
      where: { role: "STAFF" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }));
  return user!.id;
}

type Person = { customerId?: string; leadId?: string; name: string; cleanup(): Promise<void> };

async function makeCustomer(label: string): Promise<Person> {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const name = `${label} ${tag}`;
  const userId = `qm-u-${tag}`;
  const customerId = `qm-c-${tag}`;
  await prisma.user.create({ data: { id: userId, email: `qm-${tag}@example.test`, name, role: "CUSTOMER" } });
  await prisma.customer.create({ data: { id: customerId, userId, referralCode: `QM${tag}` } });
  return {
    customerId,
    name,
    cleanup: async () => {
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    },
  };
}

async function makeLead(label: string): Promise<Person> {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const name = `${label} ${tag}`;
  const leadId = `qm-l-${tag}`;
  await prisma.lead.create({ data: { id: leadId, contactName: name, phone: "9705550141" } });
  return {
    leadId,
    name,
    cleanup: async () => {
      await prisma.lead.deleteMany({ where: { id: leadId } });
    },
  };
}

async function makeEstimate(
  person: Person,
  opts: { status: "DRAFT" | "SENT" | "APPROVED"; title: string; monthly?: number; oneTime?: number },
): Promise<{ id: string; number: number; cleanup(): Promise<void> }> {
  const { prisma } = await import("../src/lib/prisma");
  const createdByUserId = await ownerId();
  const estimate = await prisma.estimate.create({
    data: {
      customerId: person.customerId ?? null,
      leadId: person.leadId ?? null,
      createdByUserId,
      title: opts.title,
      status: opts.status,
      sentAt: opts.status === "DRAFT" ? null : new Date(),
      lineItems: {
        create: [
          {
            description: "Washer and dryer set",
            monthlyPriceCents: opts.monthly ?? 7500,
            oneTimeFeeCents: opts.oneTime ?? 0,
            quantity: 1,
          },
        ],
      },
    },
    select: { id: true, estimateNumber: true },
  });
  return {
    id: estimate.id,
    number: estimate.estimateNumber,
    cleanup: async () => {
      await prisma.estimateLineItem.deleteMany({ where: { estimateId: estimate.id } });
      await prisma.estimate.deleteMany({ where: { id: estimate.id } });
    },
  };
}

type ThreadFixture = { threadId: string; cleanup(): Promise<void> };

async function makeThread(opts: {
  resolution: "RESOLVED" | "UNRESOLVED";
  status?: "OPEN" | "WAITING";
  assignedUserId?: string;
  customerId?: string;
}): Promise<ThreadFixture> {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const accountId = `qm-acct-${tag}`;
  const numberId = `qm-num-${tag}`;
  const pointId = `qm-point-${tag}`;
  const threadId = `qm-thread-${tag}`;
  await prisma.telecomAccount.create({
    data: { id: accountId, label: `qm ${tag}`, provider: "twilio", environment: "TEST", externalAccountId: `qm-${tag}`, status: "READY" },
  });
  await prisma.businessPhoneNumber.create({
    data: { id: numberId, accountId, address: "+13035550197", providerNumberId: `qm-${tag}`, registrationStatus: "APPROVED", verifiedAt: new Date() },
  });
  // ContactPoint addresses are unique per environment+channel, and specs
  // in a shard share one database in parallel — derive this fixture's
  // address from its random tag instead of planting a shared constant.
  const address = `+1303555${String(1000 + (Number.parseInt(tag.slice(0, 6), 16) % 9000))}`;
  await prisma.contactPoint.create({
    data: { id: pointId, environment: "TEST", channel: "SMS", address },
  });
  await prisma.communicationThread.create({
    data: {
      id: threadId,
      accountId,
      businessNumberId: numberId,
      externalContactPointId: pointId,
      resolution: opts.resolution,
      status: opts.status ?? "OPEN",
      assignedUserId: opts.assignedUserId ?? null,
      customerId: opts.customerId ?? null,
    },
  });
  return {
    threadId,
    cleanup: async () => {
      await prisma.auditLog.deleteMany({ where: { entityType: "CommunicationThread", entityId: threadId } });
      await prisma.contactBinding.deleteMany({ where: { contactPointId: pointId } });
      await prisma.communicationThread.deleteMany({ where: { id: threadId } });
      await prisma.contactPoint.deleteMany({ where: { id: pointId } });
      await prisma.businessPhoneNumber.deleteMany({ where: { id: numberId } });
      await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    },
  };
}

test.describe("AR-4d quotes and messages as owner", () => {
  test.use({ storageState: owner });

  test("quotes tabs, search by number, and the make-it-a-rental anchor", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const quinn = await makeCustomer("Quote Quinn");
    const lead = await makeLead("Quote Leah");
    const sent = await makeEstimate(quinn, { status: "SENT", title: "First set" });
    const approved = await makeEstimate(quinn, { status: "APPROVED", title: "Bigger set", monthly: 9000, oneTime: 5000 });
    const draft = await makeEstimate(lead, { status: "DRAFT", title: "Starter quote" });
    try {
      // Open tab: the sent quote with its pill; the approved one lives elsewhere.
      await page.goto("/desk/estimates");
      await expect(rowNamed(page, quinn.name)).toBeVisible();
      await expect(rowNamed(page, "Bigger set")).toHaveCount(0);

      // Search by quote number on the Approved tab.
      await page.goto(`/desk/estimates?status=approved&q=${approved.number}`);
      const row = rowNamed(page, quinn.name);
      await expect(row).toBeVisible();
      await expect(row).toContainText("Approved — make it a rental");
      await expect(row).toContainText("$90.00");

      // The row menu's primary action jumps to the convert panel anchor.
      await expect(async () => {
        await row.getByRole("button", { name: /More for row/ }).click();
        await expect(page.getByRole("menuitem", { name: "Make it a rental" })).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await page.getByRole("menuitem", { name: "Make it a rental" }).click();
      await expect(page).toHaveURL(new RegExp(`/desk/estimates/${approved.id}#convert`));
      await expect(page.locator("#convert")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Convert to a draft rental" })).toBeVisible();

      // The lead's draft carries the Lead chip on the phone card list.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/desk/estimates?status=drafts");
      const card = rowNamed(page, lead.name);
      await expect(card).toBeVisible();
      await expect(card).toContainText("Lead");
      await expect(card).toContainText("Draft");
    } finally {
      await sent.cleanup();
      await approved.cleanup();
      await draft.cleanup();
      await quinn.cleanup();
      await lead.cleanup();
    }
  });

  test("inbox words, and linking an unknown number to a person", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const quinn = await makeCustomer("Inbox Quinn");
    const staffUserId = await staffId();
    const unknown = await makeThread({ resolution: "UNRESOLVED", assignedUserId: staffUserId });
    const known = await makeThread({ resolution: "RESOLVED", status: "WAITING", customerId: quinn.customerId });
    try {
      await page.goto("/desk/communications");
      const unknownCard = rowNamed(page, "Unknown number");
      await expect(unknownCard).toBeVisible();
      await expect(unknownCard).toContainText("Needs a reply");
      await expect(rowNamed(page, quinn.name)).toBeVisible();

      // Into the thread, open the sheet, pick Quinn, link.
      await unknownCard.getByRole("link", { name: "Link to a person…" }).click();
      await expect(page).toHaveURL(new RegExp(`/desk/communications/${unknown.threadId}`));
      await expect(page.getByText("We don't know whose number this is yet")).toBeVisible();
      await page.getByRole("button", { name: "Link to a person…" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: /Choose person/ }).click();
      await page.getByLabel(/Search Person/).fill("Inbox Quinn");
      await page.getByRole("option", { name: new RegExp(quinn.name) }).click();
      await page.getByRole("button", { name: "Link", exact: true }).click();
      await expect(page.getByText(`This number is linked to ${quinn.name}`)).toBeVisible();
    } finally {
      await unknown.cleanup();
      await known.cleanup();
      await quinn.cleanup();
    }
  });

  test("accessibility at five sizes, light and dark", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(240_000);
    const quinn = await makeCustomer("Axe Quinn");
    const sent = await makeEstimate(quinn, { status: "SENT", title: "Axe set" });
    const unknown = await makeThread({ resolution: "UNRESOLVED" });
    try {
      await scanAccessibilityRoute(
        page,
        { path: "/desk/estimates", role: "OWNER", fixture: `/desk/estimates?q=${encodeURIComponent(quinn.name)}` },
        SIZES,
      );
      await scanAccessibilityRoute(
        page,
        { path: "/desk/communications", role: "OWNER", fixture: "/desk/communications" },
        SIZES,
      );
    } finally {
      await sent.cleanup();
      await unknown.cleanup();
      await quinn.cleanup();
    }
  });
});

test.describe("AR-4d messages as staff", () => {
  test.use({ storageState: staff });

  test("staff inbox shows their threads with plain words, and not other people's", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(staff), "Disposable Postgres and a saved staff session required.");
    test.setTimeout(150_000);
    const olga = await makeCustomer("Owner Only Olga");
    const staffUserId = await staffId();
    const mine = await makeThread({ resolution: "UNRESOLVED", assignedUserId: staffUserId });
    const theirs = await makeThread({ resolution: "RESOLVED", customerId: olga.customerId, assignedUserId: await ownerId() });
    try {
      await page.goto("/desk/communications");
      const card = rowNamed(page, "Unknown number");
      await expect(card).toBeVisible();
      await expect(card).toContainText("Needs a reply");
      await expect(page.getByText("Owner Only Olga", { exact: false })).toHaveCount(0);
    } finally {
      await mine.cleanup();
      await theirs.cleanup();
      await olga.cleanup();
    }
  });
});
