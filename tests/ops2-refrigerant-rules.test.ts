import { describe, expect, it } from "vitest";
import { checkRefrigerantInput, keepUntil, refrigerantRecordRequired, type RefrigerantInput } from "@/domains/refrigerant/rules";
import { statementLines, renderStatementPdf, type StatementFacts } from "@/domains/refrigerant/statement";

const good: RefrigerantInput = {
  refrigerantType: "R-134a", outcome: "RECOVERED", recoveredByName: "Cool Repair LLC", recoveredByAddress: "5 Main St, Greeley, CO",
  certificationNumber: "EPA-608-123", equipmentUsed: "Recovery machine", recoveredOnKey: "2026-10-20", certify: true,
};

describe("when a refrigerant record is required", () => {
  it("is needed only for refrigerant appliances that are scrapped, thrown away, or stripped then discarded", () => {
    expect(refrigerantRecordRequired(true, { choice: "SCRAP", remainder: null })).toBe(true);
    expect(refrigerantRecordRequired(true, { choice: "DISPOSE", remainder: null })).toBe(true);
    expect(refrigerantRecordRequired(true, { choice: "STRIP", remainder: "SCRAPPED" })).toBe(true);
    expect(refrigerantRecordRequired(true, { choice: "STRIP", remainder: "THROWN_AWAY" })).toBe(true);
    expect(refrigerantRecordRequired(true, { choice: "SELL", remainder: null })).toBe(false);
    expect(refrigerantRecordRequired(true, { choice: "OTHER", remainder: null })).toBe(false);
    expect(refrigerantRecordRequired(false, { choice: "SCRAP", remainder: null })).toBe(false);
  });
});

describe("checking what the owner typed", () => {
  it("accepts a complete recovered statement", () => {
    expect(checkRefrigerantInput(good).problems).toEqual([]);
  });
  it("asks for who recovered it, their address, and the signature, in plain words", () => {
    expect(checkRefrigerantInput({ ...good, recoveredByName: " " }).problems[0]).toMatch(/name of the person or shop/);
    expect(checkRefrigerantInput({ ...good, recoveredByAddress: "" }).problems[0]).toMatch(/address/);
    expect(checkRefrigerantInput({ ...good, certify: false }).problems[0]).toMatch(/sign/);
    expect(checkRefrigerantInput({ ...good, refrigerantType: "" }).problems[0]).toMatch(/refrigerant type/);
  });
  it("lets a leaked-before statement go without an address", () => {
    const leak = checkRefrigerantInput({ ...good, outcome: "LEAKED_BEFORE", recoveredByAddress: "" });
    expect(leak.problems).toEqual([]);
    expect(leak.clean.recoveredByAddress).toBe("—");
  });
  it("counts the keep-until date from the recovery date", () => {
    expect(keepUntil(new Date("2026-10-20T06:00:00Z"), 6).toISOString()).toBe("2032-10-20T06:00:00.000Z");
  });
});

describe("the signed statement", () => {
  const facts: StatementFacts = {
    businessName: "Robinson Appliance Rentals", assetNumber: "FR-12", applianceDescription: "Frigidaire FFTR Refrigerator", serialNumber: "SN123",
    refrigerantType: "R-134a", outcome: "RECOVERED", recoveredByName: "Cool Repair LLC", recoveredByAddress: "5 Main St, Greeley, CO",
    certificationNumber: "EPA-608-123", equipmentUsed: "Recovery machine", recoveredOnText: "October 20, 2026", signedByName: "Chris", signedOnText: "October 21, 2026",
  };
  it("names who recovered it, where, when, and who signed (40 CFR 82.155 contents)", () => {
    const text = statementLines(facts).join("\n");
    for (const needle of ["Cool Repair LLC", "5 Main St, Greeley, CO", "October 20, 2026", "EPA-608-123", "Signed on screen by Chris"]) expect(text).toContain(needle);
  });
  it("says the lines were not cut when the refrigerant had already leaked", () => {
    const text = statementLines({ ...facts, outcome: "LEAKED_BEFORE" }).join("\n");
    expect(text).toMatch(/already leaked/);
    expect(text).toMatch(/No lines were cut/);
  });
  it("renders a PDF", async () => {
    const bytes = await renderStatementPdf(facts);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
