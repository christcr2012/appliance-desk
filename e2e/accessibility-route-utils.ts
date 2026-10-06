import fs from "node:fs";
import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { prisma } from "../src/lib/prisma";
import type { AccessibilityRoute } from "./route-inventory";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] as const;

let seededIds:
  | Promise<{ customerId: string; agreementId: string; invoiceId: string }>
  | undefined;

async function ids() {
  seededIds ??= (async () => {
    const email = process.env.TEST_CUSTOMER_EMAIL;
    if (!email) throw new Error("TEST_CUSTOMER_EMAIL is required for generated authenticated accessibility routes.");
    const customer = await prisma.customer.findFirstOrThrow({
      where: { user: { email: email.toLowerCase() } },
      select: { id: true, rentalAgreements: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    });
    const agreementId = customer.rentalAgreements[0]?.id;
    if (!agreementId) throw new Error("The CI accessibility customer needs one agreement.");
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { customerId: customer.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    return { customerId: customer.id, agreementId, invoiceId: invoice.id };
  })();
  return seededIds;
}

export async function resolveAccessibilityFixture(route: AccessibilityRoute): Promise<string> {
  let fixture = route.fixture;
  if (!fixture.includes("__")) return fixture;
  const seeded = await ids();
  fixture = fixture
    .replaceAll("__CUSTOMER_ID__", seeded.customerId)
    .replaceAll("__AGREEMENT_ID__", seeded.agreementId)
    .replaceAll("__CUSTOMER_INVOICE_ID__", seeded.invoiceId);
  if (fixture.includes("__")) {
    throw new Error(`Unresolved accessibility fixture for ${route.path}: ${fixture}`);
  }
  return fixture;
}

function storageStateFor(role: AccessibilityRoute["role"]): BrowserContextOptions["storageState"] {
  if (role === "PUBLIC") return undefined;
  const path = role === "OWNER" ? "e2e/.auth/owner.json" : "e2e/.auth/customer.json";
  if (!fs.existsSync(path)) throw new Error(`Missing ${role} accessibility session at ${path}.`);
  return path;
}

async function scanOne(
  browser: Browser,
  route: AccessibilityRoute,
  fixture: string,
  width: 360 | 1440,
  theme: "light" | "dark",
) {
  const context = await browser.newContext({
    storageState: storageStateFor(route.role),
    viewport: { width, height: 900 },
    colorScheme: theme,
  });
  try {
    const page: Page = await context.newPage();
    await page.addInitScript((mode) => localStorage.setItem("theme", mode), theme);
    const response = await page.goto(fixture);
    expect(response, `${route.path} should return a document response`).not.toBeNull();
    expect(response!.status(), `${route.path} should not render an HTTP error state`).toBeLessThan(400);
    if (route.role !== "PUBLIC") {
      expect(new URL(page.url()).pathname, `${route.path} should stay authenticated`).not.toBe("/login");
    }
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);

    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    expect(
      results.violations,
      `${route.path} at ${width}px in ${theme} mode`,
    ).toEqual([]);
  } finally {
    await context.close();
  }
}

export async function scanAccessibilityRoute(browser: Browser, route: AccessibilityRoute) {
  const fixture = await resolveAccessibilityFixture(route);
  await Promise.all([
    scanOne(browser, route, fixture, 360, "light"),
    scanOne(browser, route, fixture, 360, "dark"),
    scanOne(browser, route, fixture, 1440, "light"),
    scanOne(browser, route, fixture, 1440, "dark"),
  ]);
}
