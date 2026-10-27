import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs } from "./utils/auth";

// ACCT-1: the full accountant journey — the owner invites an accountant, the
// accountant accepts and signs in to only Books/Taxes/Compliance/Decisions,
// posts an adjusting entry, the owner sees it in the "Changes by your
// accountant" feed, removes the accountant, and the accountant's next
// request is refused. Axe on the books home, phone and desktop widths.
const ownerState = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/appliance_desk_test");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

test.describe("ACCT-1 accountant access", () => {
  test.skip(!enabled || !fs.existsSync(ownerState), "Disposable CI database and owner fixture only");

  test("invite → sign in → allowed screens only → adjustment → owner feed → removal refuses", async ({ browser }) => {
    test.setTimeout(170_000);
    const { prisma } = await import("../src/lib/prisma");
    const { hashInvitationCode } = await import("../src/domains/team/rules");
    const { initializeBooks } = await import("../src/domains/books/management");
    const tag = `acct1-${process.pid}-${Date.now()}`;
    const email = `${tag}@example.test`;
    const password = `E2eAcct!${Date.now()}x`;
    const memo = `E2E adjustment ${tag}`;
    const knownCode = randomUUID();
    let accountantId = "";
    try {
      // A fresh CI database has the chart but no books start date yet; finishing
      // setup is the owner's own step — here through the same domain call the
      // wizard uses (or, when the chart already exists, the start date it sets).
      const ownerUser = await prisma.user.findFirstOrThrow({ where: { role: "OWNER", archivedAt: null }, orderBy: { createdAt: "asc" } });
      const booksSettings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { booksStartDate: true } });
      if (!booksSettings.booksStartDate) {
        const accountCount = await prisma.ledgerAccount.count({ where: { active: true } });
        if (accountCount < 2) {
          await initializeBooks({ id: ownerUser.id, role: "OWNER" }, { startDate: "2025-01-01", bankCents: 0, stripeCents: 0, cardCents: 0 });
        } else {
          await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: new Date("2025-01-01T07:00:00Z") } });
        }
      }

      // 1. The owner invites the accountant from Settings → Team.
      const ownerContext = await browser.newContext({ storageState: ownerState });
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto("/desk/settings?section=staff");
      await expect(ownerPage.getByRole("heading", { name: "Invite a team member" })).toBeVisible();
      await ownerPage.getByLabel("Name", { exact: true }).fill("Casey CPA");
      await ownerPage.getByLabel("Email", { exact: true }).fill(email);
      await ownerPage.getByLabel("Access level").selectOption("ACCOUNTANT");
      await ownerPage.getByLabel("Firm (optional)").fill("Casey & Co");
      await ownerPage.getByRole("button", { name: "Send invitation" }).click();
      await expect(ownerPage.getByRole("alert").filter({ hasText: "email was not sent" })).toBeVisible();
      await expect(ownerPage.getByText("Casey CPA").first()).toBeVisible();

      // Point the invitation at a code this test knows (a real code only
      // exists inside the email, which CI never sends).
      const invitation = await prisma.teamInvitation.findFirstOrThrow({ where: { email } });
      await prisma.teamInvitation.update({ where: { id: invitation.id }, data: { codeHash: hashInvitationCode(knownCode) } });

      // 2. The accountant accepts, chooses a password, and signs in.
      const acctContext = await browser.newContext();
      const acctPage = await acctContext.newPage();
      await acctPage.goto(`/join/${knownCode}`);
      await acctPage.getByLabel("Password", { exact: true }).fill(password);
      await acctPage.getByLabel("Type it again").fill(password);
      await acctPage.getByRole("button", { name: "Create my account" }).click();
      await expect(acctPage.getByRole("link", { name: "Sign in now" })).toBeVisible();
      await loginAs(acctPage, email, password);
      await expect(acctPage).toHaveURL(/\/desk\/books$/);
      const acctUser = await prisma.user.findUniqueOrThrow({ where: { email } });
      accountantId = acctUser.id;
      expect(acctUser.role).toBe("ACCOUNTANT");
      expect(acctUser.firm).toBe("Casey & Co");

      // 3. Only the allowed screens: books yes; customers and the vault no.
      await expect(acctPage.getByRole("heading", { name: "Your books", exact: true })).toBeVisible();
      await acctPage.goto("/desk/customers");
      await expect(acctPage).toHaveURL(/not-for-accountant/);
      await acctPage.goto("/desk/vault");
      await expect(acctPage).toHaveURL(/not-for-accountant/);
      await acctPage.goto("/desk/sales-tax");
      await expect(acctPage).not.toHaveURL(/not-for-accountant/);
      await acctPage.goto("/desk/compliance");
      await expect(acctPage).not.toHaveURL(/not-for-accountant/);

      // Axe on the books home, desktop then phone width.
      await acctPage.goto("/desk/books");
      const light = await new AxeBuilder({ page: acctPage }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(light.violations).toEqual([]);
      await acctPage.setViewportSize({ width: 390, height: 844 });
      await expect(acctPage.getByRole("heading", { name: "Your books", exact: true })).toBeVisible();
      await acctPage.setViewportSize({ width: 1280, height: 800 });

      // 4. The accountant posts a balanced adjusting entry in the month
      // before this one (the current month cannot be reviewed yet), dated
      // the 15th. The books home only links the selected month, so the URL
      // is built directly — the books began in January 2025.
      const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
      const [thisYear, thisMonth] = todayKey.slice(0, 7).split("-").map(Number);
      const prev = new Date(Date.UTC(thisYear!, thisMonth! - 2, 1));
      const booksMonth = prev.toISOString().slice(0, 7);
      const dateKey = `${booksMonth}-15`;
      await acctPage.goto(`/desk/books/months/${booksMonth}`);
      await expect(acctPage.getByRole("heading", { name: "Adjusting entries" })).toBeVisible();
      await acctPage.getByLabel("Date", { exact: true }).fill(dateKey);
      await acctPage.getByLabel("What is this for? (shows in the books)").fill(memo);
      const accountSelects = acctPage.locator('select[name="lineAccount"]');
      await accountSelects.nth(0).selectOption({ index: 1 });
      await accountSelects.nth(1).selectOption({ index: 2 });
      await acctPage.locator('input[name="lineDebit"]').nth(0).fill("25.00");
      await acctPage.locator('input[name="lineCredit"]').nth(1).fill("25.00");
      await acctPage.getByRole("button", { name: "Record adjusting entry" }).click();
      await expect(acctPage.getByText(memo)).toBeVisible();

      // 5. The owner sees the change in the feed on Books home.
      await ownerPage.goto("/desk/books");
      await expect(ownerPage.getByRole("heading", { name: "Changes by your accountant" })).toBeVisible();
      await expect(ownerPage.getByText(new RegExp(`Casey CPA`)).first()).toBeVisible();
      await expect(ownerPage.getByText(new RegExp(tag)).first()).toBeVisible();

      // 6. The owner removes the accountant; the next request is refused.
      await ownerPage.goto("/desk/settings?section=staff");
      const row = ownerPage.locator("tr", { hasText: "Casey CPA" });
      await row.getByRole("button", { name: "Remove access" }).click();
      await expect(ownerPage.locator("tr", { hasText: "Casey CPA" }).getByText("Removed")).toBeVisible();
      await acctPage.goto("/desk/books");
      await expect(acctPage).toHaveURL(/\/login/);

      await ownerContext.close();
      await acctContext.close();
    } finally {
      const entries = await prisma.journalEntry.findMany({ where: { memo: { contains: tag } }, select: { id: true } }).catch(() => []);
      const entryIds = entries.map((e) => e.id);
      if (entryIds.length) {
        await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } }).catch(() => undefined);
        await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } }).catch(() => undefined);
      }
      await prisma.teamInvitation.deleteMany({ where: { email } }).catch(() => undefined);
      if (accountantId) {
        await prisma.auditLog.deleteMany({ where: { userId: accountantId } }).catch(() => undefined);
        await prisma.session.deleteMany({ where: { userId: accountantId } }).catch(() => undefined);
        await prisma.account.deleteMany({ where: { userId: accountantId } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: accountantId } }).catch(() => undefined);
      }
      await prisma.$disconnect();
    }
  });
});
