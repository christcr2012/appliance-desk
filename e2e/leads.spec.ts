import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { enabled, SIZES } from "./support/ar0b-fixtures";

// AR-4b (docs/build-specs/screens/LEADS.md): the leads queue, board and
// record in a real browser.
const owner = "e2e/.auth/owner.json";

test.describe.configure({ mode: "serial" });

type LeadFixture = { id: string; name: string; cleanup(): Promise<void> };

async function makeLead(
  label: string,
  opts: {
    status?: "NEW" | "CONTACTED";
    email?: boolean;
    possibleDuplicateOfLeadId?: string;
    createdAt?: Date;
  } = {},
): Promise<LeadFixture> {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const name = `${label} ${tag}`;
  const phone = `970555${tag.slice(0, 4)}`;
  const lead = await prisma.lead.create({
    data: {
      contactName: name,
      phone,
      phoneDigits: phone,
      email: opts.email === false ? null : `lead-${tag}@example.com`,
      emailLower: opts.email === false ? null : `lead-${tag}@example.com`,
      status: opts.status ?? "NEW",
      firstContactedAt: opts.status === "CONTACTED" ? new Date() : null,
      possibleDuplicateOfLeadId: opts.possibleDuplicateOfLeadId ?? null,
      createdAt: opts.createdAt,
    },
  });
  return {
    id: lead.id,
    name,
    cleanup: async () => {
      await prisma.auditLog.deleteMany({ where: { entityId: lead.id } });
      await prisma.leadNote.deleteMany({ where: { leadId: lead.id } });
      await prisma.lead.deleteMany({ where: { id: lead.id } });
    },
  };
}

async function rowMenu(page: import("@playwright/test").Page, name: string) {
  const row = page.locator("tbody tr").filter({ hasText: name });
  await row.getByRole("button", { name: /More for row/ }).click();
}

test.describe("Leads queue and record (owner)", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("queue shows the stage tabs, counts and the Call / Email buttons", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    const fixture = await makeLead("Queue Buttons");
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/desk/leads", { waitUntil: "load" });
      const row = page.locator("tbody tr").filter({ hasText: fixture.name });
      await expect(row).toBeVisible();
      await expect(row.getByRole("link", { name: "Call" })).toHaveAttribute("href", /^tel:/);
      await expect(row.getByRole("link", { name: "Email" })).toHaveAttribute("href", /^mailto:/);
      // The New tab carries its count.
      await expect(page.getByRole("link", { name: /^New/ }).first()).toBeVisible();
    } finally {
      await fixture.cleanup();
    }
  });

  test("set a follow-up, then undo it from the toast", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    const { prisma } = await import("../src/lib/prisma");
    const fixture = await makeLead("Follow Up", { status: "CONTACTED" });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/desk/leads?stage=contacted", { waitUntil: "load" });
      await rowMenu(page, fixture.name);
      await page.getByRole("menuitem", { name: "Set follow-up…" }).click();
      await page.getByLabel("Follow up on").fill("2027-01-15");
      await page.getByRole("button", { name: "Save" }).click();
      await expect
        .poll(async () => (await prisma.lead.findUnique({ where: { id: fixture.id } }))?.nextFollowUpOn !== null)
        .toBe(true);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect
        .poll(async () => (await prisma.lead.findUnique({ where: { id: fixture.id } }))?.nextFollowUpOn)
        .toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  test("mark lost with a reason moves the lead to the Lost stage", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    const { prisma } = await import("../src/lib/prisma");
    const fixture = await makeLead("Mark Lost");
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/desk/leads", { waitUntil: "load" });
      await rowMenu(page, fixture.name);
      await page.getByRole("menuitem", { name: "Mark lost…" }).click();
      await page.getByLabel("Reason").selectOption("Too expensive");
      await page.getByRole("button", { name: "Mark lost", exact: true }).click();
      await expect
        .poll(async () => (await prisma.lead.findUnique({ where: { id: fixture.id } }))?.status)
        .toBe("LOST");
      const row = await prisma.lead.findUnique({ where: { id: fixture.id } });
      expect(row?.lostReason).toBe("Too expensive");
      await page.goto("/desk/leads?stage=lost", { waitUntil: "load" });
      await expect(page.locator("tbody tr").filter({ hasText: fixture.name })).toBeVisible();
    } finally {
      await fixture.cleanup();
    }
  });

  test("convert through the confirmation lands on the customer record", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    const { prisma } = await import("../src/lib/prisma");
    const fixture = await makeLead("Convert Me");
    let customerId: string | null = null;
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/desk/leads", { waitUntil: "load" });
      await rowMenu(page, fixture.name);
      await page.getByRole("menuitem", { name: "Convert to customer" }).click();
      await page.getByRole("button", { name: "Convert to customer" }).click();
      await page.waitForURL(/\/desk\/customers\//);
      customerId = page.url().split("/").pop() ?? null;
      const lead = await prisma.lead.findUnique({ where: { id: fixture.id } });
      expect(lead?.status).toBe("CONVERTED");
      expect(lead?.convertedCustomerId).toBe(customerId);
    } finally {
      if (customerId) {
        const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { userId: true } });
        await prisma.auditLog.deleteMany({ where: { entityId: fixture.id } });
        await prisma.customer.deleteMany({ where: { id: customerId } });
        if (customer) await prisma.user.deleteMany({ where: { id: customer.userId } });
      }
      await fixture.cleanup();
    }
  });

  test("merge two duplicates from the record banner, keeping the older lead", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    const { prisma } = await import("../src/lib/prisma");
    const older = await makeLead("Merge Older", { createdAt: new Date(Date.now() - 86_400_000) });
    const newer = await makeLead("Merge Newer", { possibleDuplicateOfLeadId: older.id });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/desk/leads/${newer.id}`, { waitUntil: "load" });
      await expect(page.getByText(/Possible duplicate of/)).toBeVisible();
      await page.getByRole("link", { name: "Review & merge" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Merge leads" }).click();
      await page.waitForURL(new RegExp(`/desk/leads/${older.id}$`));
      const merged = await prisma.lead.findUnique({ where: { id: newer.id } });
      expect(merged?.mergedIntoLeadId).toBe(older.id);
    } finally {
      await newer.cleanup();
      await older.cleanup();
    }
  });

  test("board: drag New to Contacted, and the same move from the card menu", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    const { prisma } = await import("../src/lib/prisma");
    const dragged = await makeLead("Board Drag");
    const menued = await makeLead("Board Menu");
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/desk/leads?layout=board", { waitUntil: "load" });
      const card = page.locator("article").filter({ hasText: dragged.name });
      await expect(card).toBeVisible();
      // HTML5 drag-and-drop: Playwright's dragTo stalls on this board (its
      // drag session never completes against the re-render on dragstart),
      // so dispatch the real drag events with a DataTransfer instead — the
      // app's own dragstart/dragover/drop handlers do the work.
      await page.evaluate(
        ({ sourceText, targetLabel }) => {
          const src = [...document.querySelectorAll("article")].find((a) =>
            a.textContent?.includes(sourceText),
          );
          const target = document.querySelector(`section[aria-label='${targetLabel}']`);
          if (!src || !target) throw new Error("board card or column missing");
          const dt = new DataTransfer();
          const fire = (el: Element, type: string) =>
            el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
          fire(src, "dragstart");
          fire(target, "dragenter");
          fire(target, "dragover");
          fire(target, "drop");
          fire(src, "dragend");
        },
        { sourceText: dragged.name, targetLabel: "Contacted" },
      );
      await expect
        .poll(async () => (await prisma.lead.findUnique({ where: { id: dragged.id } }))?.status)
        .toBe("CONTACTED");

      const card2 = page.locator("article").filter({ hasText: menued.name });
      await card2.getByRole("button", { name: `Actions for ${menued.name}` }).click();
      await page.getByRole("menuitem", { name: "Mark as Contacted" }).click();
      await expect
        .poll(async () => (await prisma.lead.findUnique({ where: { id: menued.id } }))?.status)
        .toBe("CONTACTED");
    } finally {
      await dragged.cleanup();
      await menued.cleanup();
    }
  });

  test("record shows the stepper, the tabs and the quote in plain words", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    const { prisma } = await import("../src/lib/prisma");
    const fixture = await makeLead("Record View", { status: "CONTACTED" });
    const ownerUser = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    const estimate = await prisma.estimate.create({
      data: { leadId: fixture.id, createdByUserId: ownerUser.id, title: "Washer set", status: "SENT", sentAt: new Date() },
    });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/desk/leads/${fixture.id}`, { waitUntil: "load" });
      await expect(page.getByRole("list", { name: "Lead stage" })).toBeVisible();
      // Scope to the record's own tab nav — the Customers module subnav
      // also carries a "Quotes" link.
      const tabs = page.getByRole("navigation", { name: "Lead sections" });
      await tabs.getByRole("link", { name: "Quotes" }).click();
      await expect(page.getByText(`Quote #${estimate.estimateNumber}`)).toBeVisible();
      await expect(page.getByText(/Sent ·/)).toBeVisible();
      await tabs.getByRole("link", { name: "What they want" }).click();
      await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
    } finally {
      await prisma.estimate.deleteMany({ where: { id: estimate.id } });
      await fixture.cleanup();
    }
  });

  test("accessibility at five sizes, light and dark", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    await scanAccessibilityRoute(page, { path: "/desk/leads", role: "OWNER", fixture: "/desk/leads" }, SIZES);
  });
});
