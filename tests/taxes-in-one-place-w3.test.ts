import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { activeTaxesTab, TAXES_SETUP_LINKS, TAXES_TABS } from "../src/lib/taxes-tabs";
import { TAX_ROUTE_REDIRECTS } from "../src/lib/tax-route-redirects";
import { fileAndPayLine, shortDateLabel, SUTS_LOGIN_URL } from "../src/domains/tax/file-and-pay";
import { deskNavigation } from "../src/lib/desk-navigation";
import { GLOSSARY } from "../src/lib/glossary";

const root = process.cwd();
const pageExists = (route: string) => {
  const dir = path.join(root, "src/app", route.replace(/:(\w+)/g, "[$1]"));
  return fs.existsSync(path.join(dir, "page.tsx")) || fs.existsSync(path.join(dir, "route.ts"));
};

describe("one Taxes menu entry with four tabs (W-3)", () => {
  it("replaces Sales tax in the menu for owners and admins only", () => {
    for (const role of ["OWNER", "ADMIN"]) {
      const links = deskNavigation(role).flatMap((group) => group.links);
      expect(links).toContainEqual({ href: "/desk/sales-tax", label: "Taxes" });
      expect(links.find((link) => link.label === "Sales tax")).toBeUndefined();
    }
    expect(deskNavigation("STAFF").flatMap((group) => group.links).some((link) => link.href === "/desk/sales-tax")).toBe(false);
  });
  it("has exactly To file, Use tax, Rates & areas and Setup", () => {
    expect(TAXES_TABS.map((tab) => tab.label)).toEqual(["To file", "Use tax", "Rates & areas", "Setup"]);
  });
  it.each([
    ["/desk/sales-tax", "file"],
    ["/desk/sales-tax/returns", "file"],
    ["/desk/sales-tax/returns/abc/amend", "file"],
    ["/desk/sales-tax/use-tax", "use-tax"],
    ["/desk/sales-tax/use-tax/period1", "use-tax"],
    ["/desk/sales-tax/use-tax/settings", "setup"],
    ["/desk/sales-tax/areas", "rates"],
    ["/desk/sales-tax/delivery-fees", "rates"],
    ["/desk/sales-tax/setup", "setup"],
    ["/desk/sales-tax/setup/accounts/x", "setup"],
    ["/desk/sales-tax/exemptions", "setup"],
    ["/desk/sales-tax/taxability", "setup"],
    ["/desk/sales-tax/audit-pack", "setup"],
    ["/desk/sales-tax/record-retention", "setup"],
    ["/desk/sales-tax/rules", "setup"],
    ["/desk/billing", null],
    ["/desk/sales-taxes", null],
  ])("puts %s on the %s tab", (pathname, tab) => {
    expect(activeTaxesTab(pathname)).toBe(tab);
  });
  it("lists every Setup screen with a plain-words name and a real page", () => {
    expect(TAXES_SETUP_LINKS.map((item) => item.label)).toEqual(expect.arrayContaining(["Customers who don't pay tax", "What gets taxed"]));
    for (const item of TAXES_SETUP_LINKS) expect(pageExists(item.href.slice(1)), item.href).toBe(true);
    for (const tab of TAXES_TABS) expect(pageExists(tab.href.slice(1)), tab.href).toBe(true);
  });
});

describe("old tax addresses forward into the Taxes area", () => {
  it("sends every old address to a page that exists and leaves no old page behind", () => {
    for (const rule of TAX_ROUTE_REDIRECTS) {
      expect(rule.permanent).toBe(true);
      expect(pageExists(rule.destination.slice(1)), rule.destination).toBe(true);
      expect(pageExists(rule.source.slice(1)), rule.source).toBe(false);
    }
    expect(TAX_ROUTE_REDIRECTS.map((rule) => rule.source)).toContain("/desk/tax/use-tax-worksheets/:periodId");
  });
  it("leaves no link to an old address anywhere in the app", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && fs.readFileSync(full, "utf8").includes("/desk/tax/") && !full.endsWith("tax-route-redirects.ts"))
          hits.push(path.relative(root, full));
      }
    };
    walk(path.join(root, "src"));
    expect(hits).toEqual([]);
  });
});

describe("the file-and-pay line every return page opens with (W-3)", () => {
  const base = { kind: "SALES_RETURN" as const, amountCents: 123456, legalDueOn: "2026-10-20", todayKey: "2026-10-10", filed: false, portalUrl: null, useTax: [] };
  it("formats business dates without time-zone drift", () => {
    expect(shortDateLabel("2026-10-20")).toBe("Oct 20");
    expect(shortDateLabel("2027-01-05")).toBe("Jan 5");
    expect(() => shortDateLabel("10/20/2026")).toThrow();
  });
  it("says what to file and pay, where and by when, with the SUTS link", () => {
    const line = fileAndPayLine(base);
    expect(line.headline).toBe("File and pay $1,234.56 on Colorado's sales tax website (SUTS) by Oct 20.");
    expect(line.link).toEqual({ href: SUTS_LOGIN_URL, label: "Open SUTS" });
    expect(line.overdue).toBe(false);
  });
  it("suggests the day to file and pay, from the timing rule", () => {
    expect(fileAndPayLine({ ...base, actOnKey: "2026-10-17" }).actOn).toBe("File and pay on Oct 17.");
  });
  it("has no suggested day when the timing rule gives none", () => {
    expect(fileAndPayLine(base).actOn).toBeNull();
  });
  it("has no suggested day once the return is filed", () => {
    expect(fileAndPayLine({ ...base, filed: true, actOnKey: "2026-10-17" }).actOn).toBeNull();
  });
  it("tells the owner a $0 return still has to be filed", () => {
    expect(fileAndPayLine({ ...base, amountCents: 0 }).headline).toBe("File a $0 return on Colorado's sales tax website (SUTS) by Oct 20. A return with nothing owed still has to be filed.");
  });
  it("marks a late return and tells the owner to use the website's amount", () => {
    const line = fileAndPayLine({ ...base, todayKey: "2026-10-21" });
    expect(line.overdue).toBe(true);
    expect(line.headline).toContain("File and pay $1,234.56");
    expect(line.headline).toContain("It was due Oct 20");
    expect(line.headline).toContain("penalty and interest");
  });
  it("shows nothing to pay once the return is filed", () => {
    const line = fileAndPayLine({ ...base, filed: true, todayKey: "2026-12-01" });
    expect(line.headline).toBe("Filed and paid. This return was due Oct 20.");
    expect(line.link).toBeNull();
    expect(line.overdue).toBe(false);
  });
  it("keeps state and Greeley use tax separate", () => {
    const line = fileAndPayLine({ ...base, kind: "USE_TAX_RETURN", amountCents: 3000,
      useTax: [{ name: "Colorado state", useTaxCents: 2500 }, { name: "Greeley", useTaxCents: 500 }, { name: "Weld County", useTaxCents: 0 }] });
    expect(line.parts).toEqual([
      { label: "Colorado state use tax", amount: "$25.00" },
      { label: "Greeley use tax", amount: "$5.00" },
    ]);
    expect(line.headline).toContain("File and pay $30.00");
  });
  it("uses the account's own https website when the owner stored one and ignores anything else", () => {
    expect(fileAndPayLine({ ...base, portalUrl: "https://example.org/file" }).link).toEqual({ href: "https://example.org/file", label: "Open the filing website" });
    expect(fileAndPayLine({ ...base, portalUrl: "javascript:alert(1)" }).link?.href).toBe(SUTS_LOGIN_URL);
    expect(fileAndPayLine({ ...base, portalUrl: "http://insecure.example" }).link?.href).toBe(SUTS_LOGIN_URL);
  });
  it("does not call the delivery-fee return a SUTS return", () => {
    const line = fileAndPayLine({ ...base, kind: "RETAIL_DELIVERY_FEE_RETURN", amountCents: 900 });
    expect(line.headline).toContain("Colorado Department of Revenue website");
    expect(line.headline).not.toContain("SUTS");
    expect(line.link).toBeNull();
  });
  it("explains SUTS and use tax in plain words", () => {
    expect(GLOSSARY["suts"].description).toMatch(/never files or pays/);
    expect(GLOSSARY["use-tax"].title).toBe("Use tax");
  });
});
