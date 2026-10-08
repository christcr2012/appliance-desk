import { businessDateKey } from "@/lib/business-date";

function escapeIcs(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

function nextDate(value: string): string {
  const day = new Date(`${value}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10).replaceAll("-", "");
}
function formatDay(date: Date): string {
  return businessDateKey(date).replaceAll("-", "");
}
function allDayEvent(id: string, date: Date, title: string, alarms: boolean): string[] {
  const key = formatDay(date);
  return [
    "BEGIN:VEVENT",
    `UID:${id}@appliance-desk.local`,
    `DTSTAMP:${key}T120000Z`,
    `DTSTART;VALUE=DATE:${key}`,
    `DTEND;VALUE=DATE:${nextDate(businessDateKey(date))}`,
    `SUMMARY:${escapeIcs(title)}`,
    ...(alarms ? [7, 1].flatMap(days => [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcs(title)}`,
      `TRIGGER:-P${days}D`,
      "END:VALARM",
    ]) : []),
    "END:VEVENT",
  ];
}
function fold(line: string): string {
  // RFC 5545's octet limit; folding on Unicode code points without
  // splitting UTF-8 sequences.
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    if (Buffer.byteLength(current + ch, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = ch;
    } else current += ch;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** A deterministic, downloadable file. No private download token or subscription URL. */
export function buildTaxFilingIcs(
  periods: Array<{ accountName: string; dueOn: Date }>,
  licenses: Array<{ accountName: string; expiresOn: Date }>,
): string {
  const events: string[] = [];
  for (const [index, item] of periods.entries()) {
    events.push(...allDayEvent(
      `tax-return-${index}-${formatDay(item.dueOn)}`,
      item.dueOn, `Tax return due: ${item.accountName}`, true,
    ));
  }
  for (const [index, item] of licenses.entries()) {
    events.push(...allDayEvent(
      `tax-license-${index}-${formatDay(item.expiresOn)}`,
      item.expiresOn, `Tax license renewal: ${item.accountName}`, false,
    ));
  }
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Appliance Desk//Colorado Tax Calendar//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...events, "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
