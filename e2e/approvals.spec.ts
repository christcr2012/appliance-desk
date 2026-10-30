import fs from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

// AR-10 §4 (carried from O-3B): the approvals loop end to end on the real
// screens — owner sets limits, an admin's over-limit credit and refunds wait,
// the owner approves or declines, and an approved Stripe refund honestly
// shows "not finished" because CI has no Stripe keys (the sending path
// itself stays proved by the O-3B database tests with a fake Stripe).
// The spec builds its own customer, bills and credit so it never touches
// the shared CI customer's records, and puts the approval limits back.
const ownerState = "e2e/.auth/owner.json";
const adminState = "e2e/.auth/admin.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const isolated =
  process.env.CI === "true" &&
  db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);
const ready =
  isolated && fs.existsSync(ownerState) && fs.existsSync(adminState);

test.describe.configure({ mode: "serial" });

let ownerContext: BrowserContext;
let adminContext: BrowserContext;
let ownerPage: Page;
let adminPage: Page;
let userId = "";
let customerId = "";
let openInvoiceId = "";
let paidInvoiceId = "";
let paidInvoiceNumber = 0;
let creditId = "";
let savedThresholds: Prisma.InputJsonValue | null = null;

const openInvoiceUrl = () =>
  `/desk/billing/customer/${customerId}/invoice/${openInvoiceId}`;
const paidInvoiceUrl = () =>
  `/desk/billing/customer/${customerId}/invoice/${paidInvoiceId}`;

async function fillMoneyForm(
  page: Page,
  formTitle: string,
  amount: string,
  note?: string,
) {
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: formTitle }) });
  await expect(form).toBeVisible();
  await form.getByLabel(/Amount \(most you can enter/).fill(amount);
  if (note !== undefined) {
    await form.getByLabel(/short note/).fill(note);
  }
  await form.getByRole("checkbox").check();
  return form;
}

test.beforeAll(async ({ browser }) => {
  test.skip(!ready, "Disposable CI database plus owner and admin sessions required.");
  ownerContext = await browser.newContext({ storageState: ownerState });
  adminContext = await browser.newContext({ storageState: adminState });
  ownerPage = await ownerContext.newPage();
  adminPage = await adminContext.newPage();

  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { approvalThresholds: true },
  });
  savedThresholds =
    (settings?.approvalThresholds as Prisma.InputJsonValue | null) ?? null;

  const user = await prisma.user.create({
    data: {
      name: "Approvals Spec Customer",
      email: "ci-approvals-customer@example.test",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  userId = user.id;
  const customer = await prisma.customer.create({
    data: { userId: user.id, referralCode: "CI-APPROVALS" },
  });
  customerId = customer.id;

  const open = await prisma.invoice.create({
    data: {
      customerId,
      status: "OPEN",
      subtotalCents: 10000,
      amountDueCents: 10000,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  openInvoiceId = open.id;

  const credit = await prisma.customerCredit.create({
    data: {
      customerId,
      amountCents: 10000,
      remainingCents: 10000,
      reason: "Approvals spec fixture credit",
    },
  });
  creditId = credit.id;

  const paid = await prisma.invoice.create({
    data: {
      customerId,
      status: "PAID",
      subtotalCents: 30000,
      taxCents: 0,
      amountDueCents: 30000,
      amountPaidCents: 30000,
    },
  });
  paidInvoiceId = paid.id;
  paidInvoiceNumber = paid.invoiceNumber;
  const receipt = await prisma.receipt.create({
    data: {
      customerId,
      source: "STRIPE",
      stripeChargeId: "ch_ci_approvals_fixture",
      amountCents: 30000,
      method: "card",
      receivedOn: new Date(),
    },
  });
  await prisma.payment.create({
    data: {
      invoiceId: paid.id,
      receiptId: receipt.id,
      amountCents: 30000,
      method: "card",
      status: "succeeded",
    },
  });
});

test.afterAll(async () => {
  if (!ready || !customerId) {
    await ownerContext?.close();
    await adminContext?.close();
    return;
  }
  await prisma.approvalRequest.deleteMany({
    where: {
      OR: [
        { targetRef: { contains: openInvoiceId } },
        { targetRef: { contains: paidInvoiceId } },
        { targetRef: { contains: creditId } },
      ],
    },
  });
  await prisma.refund.deleteMany({ where: { invoiceId: paidInvoiceId } });
  await prisma.creditApplication.deleteMany({ where: { creditId } });
  await prisma.customerCredit.deleteMany({ where: { id: creditId } });
  await prisma.payment.deleteMany({ where: { invoiceId: paidInvoiceId } });
  await prisma.receipt.deleteMany({ where: { customerId } });
  await prisma.invoice.deleteMany({ where: { customerId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.businessSettings.update({
    where: { id: "singleton" },
    data: { approvalThresholds: savedThresholds ?? {} },
  });
  await ownerContext?.close();
  await adminContext?.close();
});

test("step 1: owner sets a $10 credit limit and a $20 refund limit", async () => {
  await ownerPage.goto("/desk/settings/approvals");
  await expect(
    ownerPage.getByRole("heading", { name: "Approval limits", level: 1 }),
  ).toBeVisible();
  // The settings form gives each kind its own labelled box; the input ids are the kind keys.
  await ownerPage.locator("#CREDIT").fill("10");
  await ownerPage.locator("#REFUND").fill("20");
  await ownerPage.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(
      async () => {
        await ownerPage.reload();
        return ownerPage.locator("#CREDIT").inputValue();
      },
      { timeout: 15000 },
    )
    .toBe("10");
  await expect(ownerPage.locator("#REFUND")).toHaveValue("20");
});

test("step 2: admin applies $25 of credit and it waits for the owner, changing nothing", async () => {
  await adminPage.goto(openInvoiceUrl());
  const form = await fillMoneyForm(
    adminPage,
    "Pay this bill with the customer's credit",
    "25",
  );
  await form.getByRole("button", { name: "Apply this credit" }).click();
  await expect(form.getByRole("status")).toContainText(
    "Sent to the owner for approval. Nothing has changed yet.",
  );
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: openInvoiceId },
  });
  expect(invoice.amountPaidCents).toBe(0);
  expect(
    await prisma.creditApplication.count({ where: { creditId } }),
  ).toBe(0);
  const waiting = await prisma.approvalRequest.findFirstOrThrow({
    where: { kind: "CREDIT", status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  expect(waiting.amountCents).toBe(2500);
});

test("step 3: owner approves and the credit lands exactly once", async () => {
  await ownerPage.goto("/desk/approvals");
  const form = ownerPage
    .locator("form")
    .filter({ hasText: "Apply $25.00 of a customer's credit" });
  await expect(form).toBeVisible();
  const approve = form.getByRole("button", { name: "Approve and do it now" });
  await approve.click();
  // A second click in flight must not apply the credit twice; the server
  // locks the request and the second decision is refused as already decided.
  await approve.click({ timeout: 2000 }).catch(() => undefined);
  await expect(
    ownerPage.getByRole("status").filter({ hasText: "Approved and done." }),
  ).toBeVisible({ timeout: 15000 });
  await expect
    .poll(
      async () =>
        prisma.invoice.findUniqueOrThrow({ where: { id: openInvoiceId } }),
      { timeout: 15000 },
    )
    .toMatchObject({ amountPaidCents: 2500 });
  expect(
    await prisma.creditApplication.count({ where: { creditId } }),
  ).toBe(1);
  const credit = await prisma.customerCredit.findUniqueOrThrow({
    where: { id: creditId },
  });
  expect(credit.remainingCents).toBe(7500);
});

test("step 4: a $40 refund over the $20 limit waits, the owner declines with a reason, and no refund exists", async () => {
  test.slow();
  await adminPage.goto(paidInvoiceUrl());
  const form = await fillMoneyForm(
    adminPage,
    "Refund money to the customer",
    "40",
    "Approvals spec decline case.",
  );
  await form.getByRole("button", { name: "Refund this money" }).click();
  await expect(form.getByRole("status")).toContainText(
    "Sent to the owner for approval. Nothing has changed yet.",
  );

  await ownerPage.goto("/desk/approvals");
  const waitingForm = ownerPage
    .locator("form")
    .filter({ hasText: `Refund $40.00 on invoice #${paidInvoiceNumber}` });
  await expect(waitingForm).toBeVisible();
  await waitingForm
    .getByLabel("Note (optional)")
    .fill("Not this time — the approvals spec decline case.");
  await waitingForm.getByRole("button", { name: "Decline" }).click();
  await expect(
    ownerPage.getByRole("status").filter({ hasText: "Declined. Nothing was changed." }),
  ).toBeVisible({ timeout: 15000 });

  const request = await prisma.approvalRequest.findFirstOrThrow({
    where: { kind: "REFUND", status: "DECLINED" },
    orderBy: { createdAt: "desc" },
  });
  expect(request.decisionNote).toContain("approvals spec decline case");
  expect(await prisma.refund.count({ where: { invoiceId: paidInvoiceId } })).toBe(0);

  // What the admin can see: the bill still offers the full amount as refundable.
  await adminPage.goto(paidInvoiceUrl());
  await expect(
    adminPage.getByText("Up to $300.00 can still be refunded on this invoice."),
  ).toBeVisible();
});

test("step 5: another approved refund honestly shows as not finished, with no early Check and finish", async () => {
  test.slow();
  await adminPage.goto(paidInvoiceUrl());
  const form = await fillMoneyForm(
    adminPage,
    "Refund money to the customer",
    "40",
    "Approvals spec approve case.",
  );
  await form.getByRole("button", { name: "Refund this money" }).click();
  await expect(form.getByRole("status")).toContainText(
    "Sent to the owner for approval. Nothing has changed yet.",
  );

  await ownerPage.goto("/desk/approvals");
  const waitingForm = ownerPage
    .locator("form")
    .filter({ hasText: `Refund $40.00 on invoice #${paidInvoiceNumber}` });
  await expect(waitingForm).toBeVisible();
  await waitingForm.getByRole("button", { name: "Approve and do it now" }).click();
  // CI has no Stripe keys, so the refund can never be confirmed as sent:
  // the page must say so instead of claiming the money went back.
  await expect(
    ownerPage.getByRole("status").filter({ hasText: /Approved, but not/ }),
  ).toBeVisible({ timeout: 30000 });

  await ownerPage.goto("/desk/approvals");
  const decidedRow = ownerPage
    .locator("li")
    .filter({ hasText: `Refund $40.00 on invoice #${paidInvoiceNumber}` })
    .first();
  await expect(decidedRow).toContainText("Approved, but not confirmed as finished");
  await expect(
    decidedRow.getByRole("button", { name: "Check and finish" }),
  ).toHaveCount(0);

  const request = await prisma.approvalRequest.findFirstOrThrow({
    where: { kind: "REFUND", status: "APPROVED" },
    orderBy: { createdAt: "desc" },
  });
  expect(request.executedAt).toBeNull();
  const refunds = await prisma.refund.findMany({
    where: { invoiceId: paidInvoiceId },
  });
  expect(refunds).toHaveLength(1);
  expect(refunds[0]!.amountCents).toBe(4000);
  expect(refunds[0]!.stripeRefundId).toBeNull();
});

test("step 6: axe on the approvals page, and an approval done by keyboard alone", async () => {
  test.slow();
  await scanAccessibilityRoute(ownerPage, {
    path: "/desk/approvals",
    role: "OWNER",
    fixture: "/desk/approvals",
  });

  // One more over-limit credit request for the keyboard run.
  await adminPage.goto(openInvoiceUrl());
  const form = await fillMoneyForm(
    adminPage,
    "Pay this bill with the customer's credit",
    "15",
  );
  await form.getByRole("button", { name: "Apply this credit" }).click();
  await expect(form.getByRole("status")).toContainText(
    "Sent to the owner for approval.",
  );

  await ownerPage.goto("/desk/approvals");
  const waitingForm = ownerPage
    .locator("form")
    .filter({ hasText: "Apply $15.00 of a customer's credit" });
  await expect(waitingForm).toBeVisible();
  const approve = waitingForm.getByRole("button", {
    name: "Approve and do it now",
  });
  // Keyboard only: Tab until the Approve button holds focus, then Enter.
  let focused = false;
  for (let i = 0; i < 90 && !focused; i++) {
    await ownerPage.keyboard.press("Tab");
    focused = await approve.evaluate(
      (el) => document.activeElement === el,
    ).catch(() => false);
  }
  expect(focused).toBe(true);
  await ownerPage.keyboard.press("Enter");
  await expect(
    ownerPage.getByRole("status").filter({ hasText: "Approved and done." }),
  ).toBeVisible({ timeout: 15000 });
  expect(
    await prisma.creditApplication.count({ where: { creditId } }),
  ).toBe(2);
});
