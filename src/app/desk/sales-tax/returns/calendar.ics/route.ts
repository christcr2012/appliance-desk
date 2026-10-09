import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { buildTaxFilingIcs } from "@/domains/tax/calendar-file";

export async function GET() {
  await requireRole("OWNER", "ADMIN");
  const [periods, accounts] = await Promise.all([
    prisma.taxFilingPeriod.findMany({
      select: { id: true, dueOn: true, filingAccount: { select: { name: true } } },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      take: 2001,
    }),
    prisma.taxFilingAccount.findMany({
      where: { active: true, licenseExpiresOn: { not: null } },
      select: { name: true, licenseExpiresOn: true }, take: 501,
    }),
  ]);
  if (periods.length > 2000 || accounts.length > 500) {
    return new Response("Too many tax calendar events. Use a narrowed account export.", {
      status: 422, headers: { "Cache-Control": "private, no-store" },
    });
  }
  const ics = buildTaxFilingIcs(
    periods.map(p => ({ accountName: p.filingAccount.name, dueOn: p.dueOn })),
    accounts.flatMap(a => a.licenseExpiresOn ? [{ accountName: a.name, expiresOn: a.licenseExpiresOn }] : []),
  );
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="tax-filing-calendar.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

