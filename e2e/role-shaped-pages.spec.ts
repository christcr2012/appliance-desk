import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs } from "./utils/auth";
import { completeTwoFactorSetup } from "./utils/two-factor";

/**
 * O-2B: what each desk page actually sends to the browser, per role.
 *
 * The page text we read here is the full server response (the HTML plus the data the
 * browser is handed), not what is visible on screen. So "hidden by CSS" would still fail.
 * Four people are compared: the owner, an admin with every permission, an admin the owner
 * has limited, and a staff member. The planted fixture values (see prisma/seed.ts) are:
 *   782341 = a rental price, 932187 = repair parts cost, 8675309 = what an appliance cost.
 * Each shows up as raw cents or as dollars-and-cents, so we look for both.
 */
const MONEY = /782341|932187|8675309|7,823\.41|9,321\.87|86,753\.09|partsCostCents|laborCostCents|acquisitionCostCents/;
const states = { owner: "e2e/.auth/owner.json", admin: "e2e/.auth/admin.json", staff: "e2e/.auth/staff.json" } as const;
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const disposable = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

/** Pages that carry the seeded money values for an owner or admin. */
const moneyPages = ["/desk/inventory/ci-security-appliance", "/desk/jobs/ci-security-job", "/desk/agreements"];
/** Pages only the owner may open. Anyone else is sent away and receives none of the page. */
const ownerOnly = ["/desk/settings/permissions", "/desk/approvals", "/desk/paperwork", "/desk/privacy", "/desk/today"];
/** Pages an owner and any admin may open (limits only stop saving, never reading), and staff may not. */
const adminPages = ["/desk/settings", "/desk/billing", "/desk/revenue", "/desk/fleet", "/desk/notices", "/desk/settings/goals", "/desk/control-center"];

type Who = "owner" | "admin" | "limited" | "staff";
const contexts = new Map<Who, BrowserContext>();
let cleanup: (() => Promise<void>) | undefined;

async function limitedAdmin(browser: Browser): Promise<BrowserContext> {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID();
  const email = `limited-${tag}@example.test`;
  const password = `Fixture-${tag}!`;
  const id = execFileSync("npx", ["tsx", "scripts/create-ci-login.ts", email, password, "ADMIN"], { encoding: "utf8", env: process.env }).trim();
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER", archivedAt: null }, select: { id: true } });
  for (const capability of ["EDIT_SETTINGS", "POST_EXPENSES", "ISSUE_REFUND"]) {
    await prisma.staffCapabilityOverride.create({ data: { userId: id, capability, allowed: false, updatedByUserId: owner.id } });
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, email, password);
  await page.goto("/desk/today");
  if (new URL(page.url()).pathname === "/desk/security/setup") await completeTwoFactorSetup(page, password);
  await page.close();
  cleanup = async () => {
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: id } });
    await prisma.user.update({ where: { id }, data: { archivedAt: new Date() } });
  };
  return context;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => {
  test.skip(!disposable || !Object.values(states).every((p) => fs.existsSync(p)), "Needs the disposable CI database and its saved sign-ins.");
  test.setTimeout(120_000);
  for (const [who, file] of Object.entries(states)) contexts.set(who as Who, await browser.newContext({ storageState: file }));
  contexts.set("limited", await limitedAdmin(browser));
});
test.afterAll(async () => {
  for (const context of contexts.values()) await context.close();
  await cleanup?.();
});

/**
 * The whole server answer for one page as one person, without running the page's scripts. A refusal is either a
 * redirect status or, when the page had already started streaming, a redirect instruction inside the answer; both
 * are read as "sent away to <path>". (Reading answers directly keeps this fast: no page is drawn.)
 */
async function fetchPage(who: Who, route: string) {
  const response = await contexts.get(who)!.request.get(route, { maxRedirects: 0 });
  const body = await response.text();
  const status = response.status();
  let finalPath = route.split("?")[0]!;
  if (status >= 300 && status < 400) {
    finalPath = new URL(response.headers()["location"] ?? "/", "http://placeholder.test").pathname;
  } else {
    const streamed = /NEXT_REDIRECT;(?:push|replace);([^;]+);/.exec(body) ?? /http-equiv="refresh" content="\d+;url=([^"]+)"/.exec(body);
    if (streamed) finalPath = new URL(decodeURIComponent(streamed[1]!), "http://placeholder.test").pathname;
  }
  return { status, finalPath, body };
}

test("positive control: each planted money value really is sent to an owner and to admins", async () => {
  // Without this, "staff got none of it" could just mean the values were never there. Each planted amount must
  // appear (raw cents or dollars) somewhere on the money pages; field names alone do not count.
  const planted = { "a rental price": /782341|7,823\.41/, "repair parts cost": /932187|9,321\.87/, "what an appliance cost": /8675309|86,753\.09/ };
  for (const who of ["owner", "admin", "limited"] as const) {
    let all = "";
    for (const route of moneyPages) all += (await fetchPage(who, route)).body;
    for (const [label, pattern] of Object.entries(planted)) expect(all, `${who} should receive ${label}`).toMatch(pattern);
  }
});

test("staff never receive money values on any page, even ones they may open", async () => {
  for (const route of [...moneyPages, "/desk/today", "/desk/search?q=Test", "/desk/inventory", "/desk/jobs", "/desk/dispatch"]) {
    const r = await fetchPage("staff", route);
    expect(r.body, `staff payload for ${route}`).not.toMatch(MONEY);
  }
});

for (const route of ownerOnly.filter((r) => r !== "/desk/today")) {
  test(`${route}: owner opens it; admins, limited admins and staff are sent away with none of it`, async () => {
    const owner = await fetchPage("owner", route);
    expect(owner.finalPath).toBe(route);
    const ownerBody = owner.body;
    for (const who of ["admin", "limited", "staff"] as const) {
      const r = await fetchPage(who, route);
      expect(r.finalPath, `${who} on ${route}`).not.toBe(route);
      // The owner's page must not leak into the redirect response (data filtered on the server).
      const heading = ownerBody.match(/<h1[^>]*>([^<]{4,60})<\/h1>/)?.[1];
      if (heading) expect(r.body, `${who} payload on ${route}`).not.toContain(`>${heading}</h1>`);
    }
  });
}

for (const route of adminPages) {
  test(`${route}: owner and both kinds of admin open it; staff are sent away with none of it`, async () => {
    const owner = await fetchPage("owner", route);
    expect(owner.finalPath).toBe(route);
    const heading = owner.body.match(/<h1[^>]*>([^<]{4,60})<\/h1>/)?.[1];
    for (const who of ["admin", "limited"] as const) {
      const r = await fetchPage(who, route);
      expect(r.status, `${who} on ${route}`).toBe(200);
      expect(r.finalPath, `${who} on ${route}`).toBe(route);
    }
    const staff = await fetchPage("staff", route);
    expect(staff.finalPath, `staff on ${route}`).not.toBe(route);
    expect(staff.body).not.toMatch(MONEY);
    if (heading) expect(staff.body, `staff payload on ${route}`).not.toContain(`>${heading}</h1>`);
  });
}

test("the control center hides cards a limited admin may not use, from the page itself and not only on screen", async () => {
  // "Business name, phone, hours and logo" and "Schedule a price change for later" need Change business settings.
  const cards = [/Business name, phone, hours and logo/, /Schedule a price change for later/];
  for (const who of ["owner", "admin"] as const) {
    const body = (await fetchPage(who, "/desk/control-center")).body;
    for (const card of cards) expect(body, `${who} should see the card`).toMatch(card);
  }
  const limited = (await fetchPage("limited", "/desk/control-center")).body;
  for (const card of cards) expect(limited, "limited admin payload").not.toMatch(card);
});

for (const width of [360, 1280]) {
  for (const who of ["limited", "staff"] as const) {
    test(`${who} on a role-shaped page at ${width}px: no sideways scroll, keyboard reaches a control, no accessibility violations`, async () => {
      const page = await contexts.get(who)!.newPage();
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(who === "limited" ? "/desk/control-center" : "/desk/jobs/ci-security-job");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
}

