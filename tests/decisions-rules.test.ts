import { describe, expect, it } from "vitest";
import {
  PAST_DATE_MESSAGE,
  canonicalJson,
  decisionAttachmentProblem,
  decisionStart,
  decisionState,
  matchOption,
  needsAppChange,
  previewFingerprint,
  sameValue,
} from "@/domains/decisions/rules";
import { decisionSubject } from "@/domains/decisions/registry";

describe("decision state (newest record decides)", () => {
  it("follows the spec's state rules", () => {
    expect(decisionState(true, [])).toBe("STARTING_VALUE");
    expect(decisionState(false, [])).toBe("NO_SOURCE");
    expect(decisionState(false, [{ kind: "STARTING_VALUE_APPLIED", value: "TAXABLE" }])).toBe("NO_SOURCE");
    expect(decisionState(true, [{ kind: "STARTING_VALUE_APPLIED", value: "TAXABLE" }])).toBe("STARTING_VALUE");
    for (const kind of ["CONFIRMED", "CHANGED", "PROFESSIONAL_ANSWER"])
      expect(decisionState(false, [{ kind, value: "TAXABLE" }]), kind).toBe("CONFIRMED");
    expect(decisionState(true, [{ kind: "SENT_TO_PROFESSIONAL", value: null },
      { kind: "CONFIRMED", value: "TAXABLE" }])).toBe("WITH_PROFESSIONAL");
    expect(decisionState(true, [{ kind: "REOPENED", value: null }, { kind: "CONFIRMED", value: "X" }]))
      .toBe("STARTING_VALUE");
  });

  it("keeps an 'Other' answer out of 'confirmed' and flags it as needing an app change", () => {
    const rows = [{ kind: "PROFESSIONAL_ANSWER", value: null }];
    expect(decisionState(true, rows)).toBe("STARTING_VALUE");
    expect(needsAppChange(rows)).toBe(true);
    expect(needsAppChange([{ kind: "PROFESSIONAL_ANSWER", value: "TAXABLE" }])).toBe(false);
  });
});

describe("when a decision starts (Colorado business dates)", () => {
  const now = new Date("2026-10-25T18:00:00Z"); // 12:00 in Denver, Oct 25

  it("treats no date and today as now, a later day as scheduled", () => {
    expect(decisionStart(null, now)).toMatchObject({ key: "2026-10-25", later: false });
    expect(decisionStart("2026-10-25", now)).toMatchObject({ key: "2026-10-25", later: false });
    const later = decisionStart("2026-10-26", now);
    expect(later.later).toBe(true);
    expect(later.start.toISOString()).toBe("2026-10-26T06:00:00.000Z");
  });

  it("refuses the past, so signed and billed history never changes", () => {
    expect(() => decisionStart("2026-10-24", now)).toThrow(PAST_DATE_MESSAGE);
    // 23:30 on Oct 24 in Denver is still "yesterday" there even though it is Oct 25 in UTC.
    expect(() => decisionStart(new Date("2026-10-25T05:30:00Z"), now)).toThrow(PAST_DATE_MESSAGE);
  });

  it("uses the Denver start of day across daylight-saving changes", () => {
    const fallBack = decisionStart("2026-11-01", now);
    expect(fallBack.start.toISOString()).toBe("2026-11-01T06:00:00.000Z"); // still MDT at midnight
    expect(decisionStart("2026-11-02", now).start.toISOString()).toBe("2026-11-02T07:00:00.000Z"); // MST
    expect(decisionStart("2027-03-14", now).start.toISOString()).toBe("2027-03-14T07:00:00.000Z"); // MST at midnight
    expect(decisionStart("2027-03-15", now).start.toISOString()).toBe("2027-03-15T06:00:00.000Z"); // MDT
  });

  it("refuses dates that don't exist", () => {
    expect(() => decisionStart("2027-02-30", now)).toThrow(/valid start date/);
    expect(() => decisionStart("tomorrow", now)).toThrow(/valid start date/);
  });
});

describe("matching answers and fingerprints", () => {
  it("matches a choice by value, or by its label ignoring case and spacing", () => {
    const subject = decisionSubject("IN-34-DELIVERY-STATE")!;
    expect(matchOption(subject, "EXEMPT")?.value).toBe("EXEMPT");
    expect(matchOption(subject, "  charge SALES tax   on it ")?.value).toBe("TAXABLE");
    expect(matchOption(subject, "maybe")).toBeNull();
    expect(matchOption(subject, null)).toBeNull();
    expect(matchOption(decisionSubject("IN-71")!, 7)?.value).toBe(7);
    expect(matchOption(decisionSubject("IN-71")!, "7")).toBeNull();
  });

  it("compares values by content, not key order", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue("TAXABLE", "EXEMPT")).toBe(false);
    expect(previewFingerprint({ x: 1, y: 2 })).toBe(previewFingerprint({ y: 2, x: 1 }));
    expect(previewFingerprint({ x: 1 })).not.toBe(previewFingerprint({ x: 2 }));
  });
});

describe("completed-form attachments", () => {
  const store = "store_AbC123";
  const host = "https://abc123.private.blob.vercel-storage.com";
  it("accepts only private files kept with this question", () => {
    expect(decisionAttachmentProblem(`${host}/decisions/IN-71/form.pdf`, store, "IN-71")).toBeNull();
    expect(decisionAttachmentProblem(`${host}/decisions/IMPORT/form.docx`, store, "*")).toBeNull();
    expect(decisionAttachmentProblem(`${host}/decisions/IN-79/form.pdf`, store, "IN-71")).toMatch(/this question/);
    expect(decisionAttachmentProblem(`${host}/jobs/abc/form.pdf`, store, "IN-71")).toMatch(/this question/);
    expect(decisionAttachmentProblem("https://abc123.public.blob.vercel-storage.com/decisions/IN-71/a.pdf", store, "IN-71"))
      .toMatch(/private storage/);
    expect(decisionAttachmentProblem(`${host}/decisions/IN-71/a.pdf?download=1`, store, "IN-71")).toMatch(/private storage/);
    expect(decisionAttachmentProblem("http://abc123.private.blob.vercel-storage.com/decisions/IN-71/a.pdf", store, "IN-71"))
      .toMatch(/private storage/);
    expect(decisionAttachmentProblem(`${host}/decisions/IN-71/a.pdf`, null, "IN-71")).toMatch(/isn't set up/);
  });
});
