import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import {
  bonusElectOutClasses,
  buildElectionStatements,
  deMinimisStatementText,
  electOutStatementText,
  extensionKeyFor,
  listYearEndPlanningAttention,
  returnDueKey,
  saveBonusElectOut,
  startupNoteText,
} from "@/domains/taxben/elections";
import { signCapitalizationPolicy } from "@/domains/taxben/policy";
import { policyTemplateKey } from "@/domains/taxben/policy";
import { computeStartupSummary } from "@/domains/taxben/startup";
import { packetCsv, packetPdf, wrapPdfLine, computeScheduleCYear, type PacketData } from "@/domains/compliance/schedule-c";
import { compute1099KTieOut } from "@/domains/compliance/k-reconciliation";
import { build4562Worksheet, build4797Worksheet } from "@/domains/compliance/worksheets";
import { listAccountantChanges } from "@/domains/accountant";
import { yearEndPlanningException } from "@/domains/exceptions/rules";

// TAXBEN-2: election statements for the accountant packet, the audited
// elect-out save (accountant included), and the November 15 planning To do.

describe("election date helpers", () => {
  it("extends a due date by six calendar months", () => {
    expect(extensionKeyFor("2027-04-15")).toBe("2027-10-15");
    expect(extensionKeyFor("2027-03-15")).toBe("2027-09-15");
    expect(extensionKeyFor("2026-08-31")).toBe("2027-02-28");
  });

  it("reads the return due date from the entity type", () => {
    expect(returnDueKey(null, 2026)).toBe("2027-04-15");
    expect(returnDueKey("SINGLE_MEMBER_LLC", 2026)).toBe("2027-04-15");
    expect(returnDueKey("MULTI_MEMBER_LLC", 2026)).toBe("2027-03-15");
    expect(returnDueKey("S_CORP", 2026)).toBe("2027-03-15");
  });
});

describe("packet PDF wrapping (review fix)", () => {
  it("wraps long statement paragraphs without losing a word", () => {
    const paragraph =
      "Under Internal Revenue Code section 168(k)(7), Robinson Appliance Rentals elects not to deduct bonus depreciation for the following classes of property placed in service during 2028: 5-year property (rental appliances). Property in these classes is depreciated under the regular rules instead.";
    const lines = wrapPdfLine(paragraph);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 100)).toBe(true);
    expect(lines.join(" ")).toBe(paragraph);
    expect(wrapPdfLine("")).toEqual([""]);
    expect(wrapPdfLine("short line")).toEqual(["short line"]);
  });
});

describe("statement texts", () => {
  it("the de minimis statement names the business, address, EIN last-4 and the limit", () => {
    const text = deMinimisStatementText({
      businessName: "Robinson Appliance Rentals",
      address: "Greeley, CO",
      einLast4: "6789",
      limitCents: 250_000,
      year: 2028,
    });
    expect(text).toContain("De minimis safe harbor election — 2028");
    expect(text).toContain("Robinson Appliance Rentals");
    expect(text).toContain("Greeley, CO");
    expect(text).toContain("EIN ending 6789");
    expect(text).toContain("$2,500.00");
    expect(text).not.toMatch(/\d{2}-\d{7}/); // never a full EIN
  });

  it("the elect-out statement lists the chosen classes", () => {
    const text = electOutStatementText({
      businessName: "Robinson Appliance Rentals",
      address: null,
      einLast4: null,
      classLabels: ["5-year property (rental appliances)"],
      year: 2028,
    });
    expect(text).toContain("168(k)(7)");
    expect(text).toContain("5-year property (rental appliances)");
    expect(text).toContain("EIN not on file");
  });

  it("the Section 195 note carries the began date and the year's figures", () => {
    const text = startupNoteText({
      businessName: "Robinson Appliance Rentals",
      beganOn: "2026-06-01",
      beganStored: true,
      totalCents: 900_000,
      firstYearCents: 500_000,
      amortizationCents: 26_667,
      remainingCents: 373_333,
      amortizationMonths: 180,
      year: 2026,
    });
    expect(text).toContain("Section 195");
    expect(text).toContain("2026-06-01");
    expect(text).toContain("$9,000.00");
    expect(text).toContain("180 months");
  });

  it("the year-end planning wording is information, never advice to buy", () => {
    const item = yearEndPlanningException({
      year: 2028,
      profitCents: 1_200_000,
      sepCents: 240_000,
      soloCents: 300_000,
      midQuarterNote: null,
      deMinimisExpensedCents: 50_000,
      since: businessDateFromKey("2028-11-15")!,
    });
    expect(item.title).toContain("Year-end tax planning");
    expect(item.detail).toContain("$12,000.00");
    expect(item.detail).toContain("Questions for your CPA");
    expect(item.detail).not.toMatch(/should buy|we recommend|you should/i);
    expect(item.todoKey).toBe("taxben-year-end:2028");
  });
});

// ---------------------------------------------------------------------------
// Real Postgres: assembly, the audited save, the packet, the To do window
// ---------------------------------------------------------------------------

const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return new URL("http://localhost/");
  }
})();
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("elections (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `taxben2-owner-${tag}`;
  const accountantId = `taxben2-accountant-${tag}`;
  const staffId = `taxben2-staff-${tag}`;
  const YEAR = 2028;
  let electionsBefore: unknown = undefined;
  let electionsTouched = false;

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [ownerId, accountantId, staffId] } },
    });
    await prisma.businessPaperwork.deleteMany({
      where: { templateKey: policyTemplateKey(YEAR) },
    });
    await prisma.taxYearFacts.deleteMany({ where: { year: YEAR } });
    if (electionsTouched) {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { deMinimisElections: (electionsBefore ?? null) as never },
      });
    }
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, accountantId, staffId] } } });
  });

  it("sets up the actors", async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `taxben2-owner-${tag}@example.test`, name: "Test Owner", role: "OWNER" },
        { id: accountantId, email: `taxben2-cpa-${tag}@example.test`, name: "Test CPA", role: "ACCOUNTANT" },
        { id: staffId, email: `taxben2-staff-${tag}@example.test`, name: "Test Staff", role: "STAFF" },
      ],
    });
    const settings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { deMinimisElections: true },
    });
    electionsBefore = settings?.deMinimisElections ?? null;
    expect(await bonusElectOutClasses(prisma, YEAR)).toEqual([]);
  });

  it("withholds the de minimis statement until the year's policy is signed", async () => {
    const before = await buildElectionStatements(prisma, YEAR, "2029-04-15");
    expect(before.deMinimisIncluded).toBe(false);
    expect(before.deMinimisText).toContain("Not included");
    expect(before.dueOnKey).toBe("2029-04-15");
    expect(before.extensionKey).toBe("2029-10-15");
    expect(before.electOutText).toBeNull();

    await signCapitalizationPolicy(ownerId, YEAR, businessDateFromKey("2028-01-05")!);
    const after = await buildElectionStatements(prisma, YEAR, "2029-04-15");
    expect(after.deMinimisIncluded).toBe(true);
    expect(after.deMinimisText).toContain("De minimis safe harbor election");
    expect(after.deMinimisText).toContain("$2,500.00");
    expect(after.deMinimisText).not.toMatch(/\d{2}-\d{7}/);
    const profile = await prisma.complianceProfile.findUnique({
      where: { id: "singleton" },
      select: { einLast4: true },
    });
    if (profile?.einLast4) expect(after.deMinimisText).toContain(`EIN ending ${profile.einLast4}`);
  });

  it("shows the switched-off line when the year's election is off", async () => {
    const settings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { deMinimisElections: true },
    });
    const map: Record<string, boolean> = {};
    if (
      settings?.deMinimisElections &&
      typeof settings.deMinimisElections === "object" &&
      !Array.isArray(settings.deMinimisElections)
    ) {
      for (const [k, v] of Object.entries(settings.deMinimisElections as Record<string, unknown>)) {
        if (typeof v === "boolean") map[k] = v;
      }
    }
    electionsTouched = true;
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { deMinimisElections: { ...map, [String(YEAR)]: false } },
    });
    const off = await buildElectionStatements(prisma, YEAR, "2029-04-15");
    expect(off.deMinimisIncluded).toBe(false);
    expect(off.deMinimisText).toContain("switched off");
  });

  it("lets the accountant save the elect-out choice, audited and listed for the owner", async () => {
    await saveBonusElectOut(accountantId, YEAR, ["rentalAppliances"]);
    expect(await bonusElectOutClasses(prisma, YEAR)).toEqual(["rentalAppliances"]);

    const audit = await prisma.auditLog.findFirst({
      where: { userId: accountantId, action: "taxben.elections.save", entityId: String(YEAR) },
    });
    expect(audit).not.toBeNull();

    const statements = await buildElectionStatements(prisma, YEAR, "2029-04-15");
    expect(statements.electOutText).toContain("5-year property (rental appliances)");

    const feed = await listAccountantChanges(ownerId);
    const entry = feed.find((c) => c.summary.includes("bonus depreciation election"));
    expect(entry).toBeDefined();
    expect(entry!.href).toBe(`/desk/sales-tax/benefits?year=${YEAR}`);

    // Clearing works too, and staff are refused throughout.
    await saveBonusElectOut(ownerId, YEAR, []);
    expect(await bonusElectOutClasses(prisma, YEAR)).toEqual([]);
    await expect(saveBonusElectOut(staffId, YEAR, ["rentalAppliances"])).rejects.toThrow();
    await expect(saveBonusElectOut(accountantId, YEAR, ["not-a-class"])).rejects.toThrow(
      /not in the rule book/,
    );
  });

  it("carries the Section 195 note only when start-up costs tie to the year", async () => {
    const summary = await computeStartupSummary(prisma);
    const statements = await buildElectionStatements(prisma, YEAR, "2029-04-15");
    if (summary.beganOn && summary.totalCents > 0) {
      expect(statements.startupNoteText).toContain("Section 195");
    } else {
      expect(statements.startupNoteText).toBeNull();
    }
  });

  it("puts the elections section on the packet CSV only when the packet carries it", async () => {
    const elections = await buildElectionStatements(prisma, YEAR, "2029-04-15");
    const base: PacketData = {
      year: YEAR,
      scheduleC: await computeScheduleCYear(YEAR),
      tieOut: await compute1099KTieOut(YEAR),
      worksheet4562: await build4562Worksheet(YEAR),
      worksheet4797: await build4797Worksheet(YEAR),
      homeOffice: false,
    };
    expect(packetCsv(base)).not.toContain("Elections and statements");
    const withElections = packetCsv({ ...base, elections });
    expect(withElections).toContain("Elections and statements");
    expect(withElections).toContain("2029-10-15");
    const pdf = await packetPdf({ ...base, elections });
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  it("opens the year-end planning window on November 15, not before", async () => {
    expect(await listYearEndPlanningAttention(businessDateFromKey("2028-11-10")!)).toEqual([]);
    expect(await listYearEndPlanningAttention(businessDateFromKey("2029-01-15")!)).toEqual([]);
    const items = await listYearEndPlanningAttention(businessDateFromKey("2028-11-20")!);
    expect(items).toHaveLength(1);
    expect(items[0]!.year).toBe(2028);
    expect(typeof items[0]!.profitCents).toBe("number");
  });
});
