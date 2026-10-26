import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import mammoth from "mammoth";
import { expect, test, type Page } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { loginAs } from "./utils/auth";
import { completeTwoFactorSetup } from "./utils/two-factor";

// DEC-1b: Settings › Decisions & reviews in a real browser. The owner keeps, changes, asks, enters a professional's
// answer with their form, downloads both questionnaire formats and imports a completed form. Admins see the cards
// with no buttons; staff are sent away. Axe at five sizes, light and dark.
//
// Only "keep what the app does now" questions and an unchanged retention value are used, so nothing another browser
// test depends on changes. The records this test adds are removed at the end so it can run again.
const owner = "e2e/.auth/owner.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/appliance_desk_test";
const FIRST = ["IN-06", "IN-71", "IN-44"];
const SECOND = ["IN-46"];
// 360 and 1440 are scanned (light and dark) by the generated route scans (route-inventory.ts); these add three more sizes.
// Widest first: the phone width is then always measured right after a tablet width (a jump from 1920 straight to
// a phone measured 19 px too wide once in CI; cause not found yet — noted in the PR for AR-0b to look at).
const SIZES = [1920, 820, 390] as const;

test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
// The two tests touch different things, so they may run on both workers at once (shard time budget).
test.describe.configure({ mode: "parallel" });

function card(page: Page, title: string | RegExp) {
  return page.getByRole("article", { name: title });
}

test("decisions: keep, change, ask, download and enter an answer", async ({ page }) => {
  test.skip(!enabled, "Disposable Postgres and a saved owner session required.");
  test.setTimeout(170_000);
  const { prisma } = await import("../src/lib/prisma");
  const { decisionSubject } = await import("../src/domains/decisions/registry");
  const started = new Date();
  const title = (id: string) => decisionSubject(id)!.title;
  try {
    // Start clean for these questions (an earlier run in this database may have answered them).
    await prisma.decisionRecord.deleteMany({ where: { subjectId: { in: FIRST } } });

    // 1. Keep this — on "For you".
    await page.goto("/desk/settings/decisions");
    await expect(page.getByRole("heading", { name: "Decisions & reviews", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /^For you \d+/ })).toHaveAttribute("aria-current", "page");
    const keep = card(page, title("IN-06"));
    await expect(keep.getByText("No public source — careful choice in use")).toBeVisible();
    await keep.getByRole("button", { name: "Keep this" }).click();
    await expect(page.getByText(`Kept: ${title("IN-06")}`)).toBeVisible();
    await page.goto("/desk/settings/decisions?for=ANSWERED");
    await expect(card(page, title("IN-06")).getByText(/^Confirmed by .+ on /)).toBeVisible();

    // 2. Change… — the same retention value, so nothing else changes; then Reopen it.
    await page.goto("/desk/settings/decisions?for=CPA");
    const retention = card(page, title("IN-71"));
    await retention.getByRole("button", { name: "Change…" }).click();
    const sheet = page.getByRole("dialog", { name: `Change: ${title("IN-71")}` });
    await sheet.getByLabel("7 years after the appliance leaves the fleet").check();
    await sheet.getByLabel("Note (optional)").fill("Same as now, confirmed in the browser test");
    await sheet.getByRole("button", { name: "Save change" }).click();
    // Either the success toast or the sheet's plain error, so a refusal shows its reason here.
    await expect(page.getByText(`Changed: ${title("IN-71")}`).or(sheet.getByRole("alert"))).toBeVisible();
    await expect(page.getByText(`Changed: ${title("IN-71")}`)).toBeVisible();
    await page.goto("/desk/settings/decisions?for=ANSWERED");
    await card(page, title("IN-71")).getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText(`Reopened: ${title("IN-71")}`)).toBeVisible();

    // 3. Ask my attorney — moves the CPA question to the attorney tab, value unchanged.
    await page.goto("/desk/settings/decisions?for=CPA");
    await card(page, title("IN-44")).getByRole("button", { name: "Ask my…" }).click();
    await page.getByRole("menuitem", { name: "Ask my attorney" }).click();
    await expect(page.getByText('Moved to "For your attorney". The app keeps doing what it does now.')).toBeVisible();

    // 4. Download both formats from the attorney tab.
    await page.goto("/desk/settings/decisions?for=ATTORNEY");
    const asked = card(page, title("IN-44"));
    await expect(asked.getByText(/^With your attorney since /)).toBeVisible();
    await expect(asked.getByText("You can use this now; their answer may change it.")).toBeVisible();
    const docx = await page.request.get("/desk/settings/decisions/form?for=ATTORNEY&format=docx");
    expect(docx.status()).toBe(200);
    expect(docx.headers()["content-disposition"]).toMatch(/decisions-attorney-\d{4}-\d{2}-\d{2}\.docx/);
    const docxBytes = await docx.body();
    const { value: text } = await mammoth.extractRawText({ buffer: docxBytes });
    expect(text.split("[DQ-IN-44]").length - 1).toBe(2);
    const pdf = await page.request.get("/desk/settings/decisions/form?for=ATTORNEY&format=pdf");
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(page.getByRole("link", { name: "Download questions (Word)" })).toBeVisible();

    // 5. Enter their answer…, with their completed form attached.
    await asked.getByRole("button", { name: "Enter their answer…" }).click();
    const answer = page.getByRole("dialog", { name: `Enter their answer: ${title("IN-44")}` });
    await answer.getByLabel("Keep what the app does now").check();
    await answer.getByLabel("Who answered").fill("Pat Lee");
    await answer.getByLabel("Firm (optional)").fill("Lee Law");
    await answer.getByLabel("Their explanation (optional)").fill("Fine as it is.");
    await answer.getByLabel(/Their completed form/).setInputFiles({ name: "answers.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docxBytes });
    await answer.getByRole("button", { name: "Save their answer" }).click();
    await expect(page.getByText(/^Their answer was saved/)).toBeVisible();
    const saved = await prisma.decisionRecord.findFirstOrThrow({ where: { subjectId: "IN-44", kind: "PROFESSIONAL_ANSWER" } });
    expect(saved).toMatchObject({ professionalName: "Pat Lee", professionalFirm: "Lee Law", audience: "ATTORNEY", via: "SCREEN" });
  } finally {
    await prisma.decisionRecord.deleteMany({ where: { subjectId: { in: FIRST }, createdAt: { gte: started } } });
  }
});

// Its own question (IN-46), so it can run beside the test above on the other worker.
test("decisions: a renamed picture is refused; import a completed form; layout and accessibility", async ({ page }) => {
  test.skip(!enabled, "Disposable Postgres and a saved owner session required.");
  test.setTimeout(150_000);
  const { prisma } = await import("../src/lib/prisma");
  const { decisionSubject } = await import("../src/domains/decisions/registry");
  const started = new Date();
  const title = (id: string) => decisionSubject(id)!.title;
  try {
    await prisma.decisionRecord.deleteMany({ where: { subjectId: { in: SECOND } } });
    // A picture renamed .pdf is refused by its content.
    await page.goto("/desk/settings/decisions?for=CPA");
    await card(page, title("IN-46")).getByRole("button", { name: "Enter their answer…" }).click();
    const bad = page.getByRole("dialog", { name: `Enter their answer: ${title("IN-46")}` });
    await bad.getByLabel("Keep what the app does now").check();
    await bad.getByLabel("Who answered").fill("Pat Lee");
    await bad.getByLabel(/Their completed form/).setInputFiles({ name: "form.pdf", mimeType: "application/pdf",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
    await bad.getByRole("button", { name: "Save their answer" }).click();
    await expect(bad.getByRole("alert")).toHaveText("Choose a PDF or a Word (.docx) file.");
    await bad.getByRole("button", { name: "Close" }).click();

    // 6. Import a completed form (pasted answer sheet): preview, then apply.
    await page.goto("/desk/settings/decisions");
    await page.getByRole("button", { name: "More for Decisions & reviews" }).click();
    await page.getByRole("menuitem", { name: "Import a completed form" }).click();
    await expect(page.getByRole("heading", { name: "Import a completed form", level: 1 })).toBeVisible();
    await page.getByLabel("Or paste the answers (for a PDF or a scan)").fill([
      "Answer sheet",
      "Answered by / firm / date: Pat Lee / Lee CPA / " + started.toISOString().slice(0, 10),
      "[DQ-IN-46] Answer: Keep what the app does now",
      "[DQ-NOT-REAL] Answer: Yes",
    ].join("\n"));
    await page.getByRole("button", { name: "Preview answers" }).click();
    await expect(page.getByRole("heading", { name: "What would change" })).toBeVisible();
    await expect(page.getByText("This code isn't a question in the app.").filter({ visible: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Record their answers" }).click();
    await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
    await expect(page.getByText("Confirmed with no change: 1")).toBeVisible();
    await expect(page.getByText("Skipped (couldn't apply): 1")).toBeVisible();

    // Back from a desktop width to a phone: nothing may stick out sideways (names what does, if anything).
    await page.goto("/desk/settings/decisions");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.waitForTimeout(300);
    const wide = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} right=${Math.round(el.getBoundingClientRect().right)}`));
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect({ sideways, wide: sideways > 0 ? wide : [] }).toEqual({ sideways: 0, wide: [] });
    await page.setViewportSize({ width: 1280, height: 900 });

    // 7. Accessibility, light and dark (the import page is scanned by the generated route scans).
    await scanAccessibilityRoute(page, { path: "/desk/settings/decisions", role: "OWNER", fixture: "/desk/settings/decisions?for=CPA" }, SIZES);
  } finally {
    await prisma.decisionRecord.deleteMany({ where: { subjectId: { in: SECOND }, createdAt: { gte: started } } });
  }
});

test("decisions: admins read without buttons; staff are sent away", async ({ browser }) => {
  const staffState = "e2e/.auth/staff.json";
  test.skip(!enabled || !fs.existsSync(staffState), "Disposable Postgres and a saved staff session required.");
  test.setTimeout(90_000);
  const { prisma } = await import("../src/lib/prisma");
  // A fresh admin of this test's own, so other tests that sign admins out or limit them can't affect it.
  const email = `dec1b-admin-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Dec1b-${randomUUID()}`;
  const adminId = execFileSync("npx", ["tsx", "scripts/create-ci-login.ts", email, password, "ADMIN"], { encoding: "utf8", env: process.env }).trim();
  const admin = await browser.newContext();
  const staff = await browser.newContext({ storageState: staffState });
  try {
    const a = await admin.newPage();
    await loginAs(a, email, password);
    await a.goto("/desk/today");
    if (new URL(a.url()).pathname === "/desk/security/setup") await completeTwoFactorSetup(a, password);
    // The read itself, as this admin, straight from the domain (reports the real error if it fails).
    const { listDecisions } = await import("../src/domains/decisions");
    const read = await listDecisions(adminId).then((cards) => `${cards.length} cards`, (error: unknown) =>
      `failed: ${error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : String(error)}`);
    expect(read).toMatch(/^\d+ cards$/);
    // The server's answer first (no scripts run): the page itself, with cards and without any owner button.
    const served = await a.request.get("/desk/settings/decisions?for=CPA", { maxRedirects: 0 });
    const html = await served.text();
    const redirect = /NEXT_REDIRECT;[a-z]+;([^;"\\]+)/.exec(html)?.[1] ??
      /http-equiv="refresh" content="\d+;url=([^"]+)"/.exec(html)?.[1] ?? served.headers()["location"] ??
      /NEXT_HTTP_ERROR_FALLBACK;\d+/.exec(html)?.[0] ?? "none";
    const digest = /digest\\?"\s*:\s*\\?"([^"\\]+)/.exec(html)?.[1] ?? "none";
    const headings = [...html.matchAll(/<h1[^>]*>([\s\S]{0,80}?)<\/h1>/g)].map((m) => m[1]).join(" | ");
    const pageTitle = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    expect({ status: served.status(), redirect, digest, heading: html.includes("Decisions &amp; reviews</h1>") },
      `admin's server answer for Decisions & reviews (title "${pageTitle}", h1: ${headings})`)
      .toEqual({ status: 200, redirect: "none", digest: "none", heading: true });
    expect(html).not.toContain(">Keep this<");
    await a.goto("/desk/settings/decisions?for=CPA");
    await expect(a.getByRole("heading", { name: "Decisions & reviews", level: 1 }),
      `admin page ended at ${a.url()}: ${(await a.locator("body").innerText()).slice(0, 300)}`).toBeVisible();
    await expect(a.getByRole("article").first()).toBeVisible();
    await expect(a.getByRole("button", { name: "Keep this" })).toHaveCount(0);
    await expect(a.getByRole("button", { name: "Change…" })).toHaveCount(0);
    await expect(a.getByRole("button", { name: "More for Decisions & reviews" })).toHaveCount(0);
    expect((await a.request.post("/api/desk/decisions/answer", { multipart: { id: "IN-71", option: "0" } })).status()).toBe(403);
    const s = await staff.newPage();
    await s.goto("/desk/settings/decisions");
    await expect(s).not.toHaveURL(/\/desk\/settings\/decisions/);
    await s.goto("/desk/settings/decisions/import");
    await expect(s).not.toHaveURL(/\/desk\/settings\/decisions\/import/);
  } finally {
    await admin.close();
    await staff.close();
    await prisma.user.update({ where: { id: adminId }, data: { archivedAt: new Date() } });
  }
});
