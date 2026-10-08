import { describe, expect, it } from "vitest";
import { businessDateFromKey } from "@/lib/business-date";
import { buildTaxFilingIcs } from "@/domains/tax/calendar-file";
const day = (key: string) => {
  const parsed = businessDateFromKey(key);
  if (!parsed) throw new Error("Bad test date");
  return parsed;
};
describe("Colorado filing ICS calendar", () => {
  it("exports deterministic RFC 5545 all-day events, alarms and trailing CRLF", () => {
    const input = [{ accountName: "Colorado State", dueOn: day("2026-03-08") }];
    const ics = buildTaxFilingIcs(input, [{ accountName: "City License", expiresOn: day("2026-11-01") }]);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260308");
    expect(ics).toContain("DTEND;VALUE=DATE:20260309");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261101");
    expect(ics).toContain("DTEND;VALUE=DATE:20261102");
    expect(ics).toContain("TRIGGER:-P7D");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
    expect(buildTaxFilingIcs(input, [{ accountName: "City License", expiresOn: day("2026-11-01") }])).toBe(ics);
  });
  it("escapes user supplied names and folds large lines at 75 octets", () => {
    const text = "Café, Rentals; 123\\ Main\nline " + "🚚".repeat(40);
    const ics = buildTaxFilingIcs([{ accountName: text, dueOn: day("2026-10-20") }], []);
    expect(ics).toContain("\\,");
    expect(ics).toContain("\\;");
    expect(ics).toContain("\\\\");
    expect(ics).toContain("\\n");
    expect(ics.split("\r\n")
      .every(line => Buffer.byteLength(line, "utf8") <= 75)).toBe(true);
  });
});
