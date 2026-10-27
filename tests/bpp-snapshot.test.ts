import { describe, expect, it } from "vitest";
import {
  bppSnapshotFromPrepared,
  bppSpreadsheetCsv,
  type BppSnapshot,
} from "@/domains/compliance/bpp";
import { assertNoFullTaxId } from "@/domains/compliance/filings";

// CMP-4: the Weld declaration spreadsheet and the prepared-data readers.
// The snapshot itself is built from the database (see the integration
// suite); these cover the pure shapes the downloads and the page rely on.

const snapshot: BppSnapshot = {
  year: 2027,
  asOf: "2027-01-01",
  totalCostCents: 86000,
  over350Count: 2,
  firstTimeFiler: true,
  thresholdCents: 5600000,
  verdict: "OVER",
  extension: { tenDayFeeCents: 2000, twentyDayFeeCents: 4000 },
  items: [
    {
      assetNumber: "W-101",
      description: "Washer — Samsung WA45",
      serialNumber: "SN123",
      category: "Rental appliances",
      yearAcquired: 2026,
      placedInService: "Mar 2026",
      costCents: 45000,
      over350: true,
      rentedOut: true,
      userName: "Casey Renter",
      userAddress: "12 Oak St, Greeley, CO 80631",
      rentLineLabel: "Washer @ $45/mo",
      rentLineMonthlyCents: 4500,
      unitsOnLine: 1,
      monthlyRentCents: 4500,
    },
    {
      assetNumber: "D-102",
      description: "Dryer — Samsung DV45",
      serialNumber: null,
      category: "Rental appliances",
      yearAcquired: 2026,
      placedInService: "Apr 2026",
      costCents: 41000,
      over350: true,
      rentedOut: false,
      userName: null,
      userAddress: null,
      rentLineLabel: null,
      rentLineMonthlyCents: null,
      unitsOnLine: 0,
      monthlyRentCents: null,
    },
  ],
};

describe("BPP spreadsheet", () => {
  it("lists every item with its renter and rent, then the total", () => {
    const csv = bppSpreadsheetCsv(snapshot);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("Name and address of user");
    expect(lines[1]).toContain("W-101");
    expect(lines[1]).toContain("Washer — Samsung WA45 — serial SN123");
    expect(lines[1]).toContain("450.00");
    expect(lines[1]).toContain("45.00");
    expect(lines[2]).toContain("410.00");
    expect(lines[2]).toContain(",No,"); // the dryer was on hand
    expect(lines[3]).toContain("Total original cost, 2 items");
    expect(lines[3]).toContain("860.00");
  });

  it("carries the whole-line rent for a set whose rent is never split (PR #670 review)", () => {
    const setSnapshot: BppSnapshot = {
      ...snapshot,
      items: snapshot.items.map((item) => ({
        ...item,
        rentedOut: true,
        userName: "Casey Renter",
        userAddress: "12 Oak St, Greeley, CO 80631",
        rentLineLabel: "Washer/Dryer set",
        rentLineMonthlyCents: 6000,
        unitsOnLine: 2,
        monthlyRentCents: null, // a set's rent is never split by invention
      })),
    };
    const csv = bppSpreadsheetCsv(setSnapshot);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("whole line, shared by its units");
    // The per-unit rent cell stays empty; the whole line's $60.00 lands
    // in its own labeled column on both units of the set.
    expect(lines[1]).toContain(",Washer/Dryer set,60.00");
    expect(lines[2]).toContain(",Washer/Dryer set,60.00");
  });

  it("quotes cells that carry commas", () => {
    const csv = bppSpreadsheetCsv(snapshot);
    expect(csv).toContain('"Casey Renter, 12 Oak St, Greeley, CO 80631"');
  });
});

describe("the full-tax-ID guard and serial numbers (PR #668 review)", () => {
  it("lets a nine-digit appliance serial number through preparation", () => {
    expect(() =>
      assertNoFullTaxId({ snapshot: { items: [{ assetNumber: "W-9", serialNumber: "123456789" }] } }),
    ).not.toThrow();
  });

  it("still refuses a real tax ID anywhere else in the prepared data", () => {
    expect(() => assertNoFullTaxId({ payer: { tin: "123456789" } })).toThrow(/full tax ID/);
    expect(() => assertNoFullTaxId({ note: "SSN 123-45-6789" })).toThrow(/full tax ID/);
    expect(() => assertNoFullTaxId({ items: [{ serialNumber: "OK123", other: "12-3456789" }] })).toThrow(
      /full tax ID/,
    );
  });
});

describe("prepared-data readers", () => {
  it("round-trips a snapshot and refuses foreign shapes", () => {
    expect(bppSnapshotFromPrepared({ snapshot })?.totalCostCents).toBe(86000);
    expect(bppSnapshotFromPrepared(null)).toBeNull();
    expect(bppSnapshotFromPrepared({})).toBeNull();
    expect(bppSnapshotFromPrepared({ snapshot: { items: "nope" } })).toBeNull();
    expect(bppSnapshotFromPrepared({ snapshot: { items: [], totalCostCents: "860" } })).toBeNull();
  });
});
