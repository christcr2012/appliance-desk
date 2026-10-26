import { requireRole } from "@/lib/session";
import { listComplianceFilings } from "@/domains/compliance/filings";
import { obligationByKey } from "@/domains/compliance/registry";
import { businessDateKey } from "@/lib/business-date";

/**
 * CMP-1: a calendar file of compliance act-on dates (all-day events with a
 * day-before reminder), so the dates also live in the owner's own calendar.
 * Built directly rather than through the sales-tax helper, whose summaries
 * are worded for tax returns.
 */
export async function GET() {
  await requireRole("OWNER", "ADMIN");
  const filings = await listComplianceFilings();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const events: string[] = [];
  for (const filing of filings) {
    if (["NOT_APPLICABLE", "DONE_ELSEWHERE", "ACCEPTED"].includes(filing.state)) continue;
    const obligation = obligationByKey(filing.obligationKey);
    const title = obligation?.title ?? filing.obligationKey;
    const day = businessDateKey(filing.actOn).replaceAll("-", "");
    const due = businessDateKey(filing.dueOn);
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:compliance-${filing.id}@appliance-desk`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day}`,
        `SUMMARY:${title} (${filing.periodKey}) — due ${due}`,
        "BEGIN:VALARM",
        "TRIGGER:-P1D",
        "ACTION:DISPLAY",
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n"),
    );
  }
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Appliance Desk//Compliance//EN", ...events, "END:VCALENDAR"].join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="compliance-dates.ics"',
    },
  });
}
