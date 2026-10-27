import type { ExceptionItem } from "./rules";
import { prisma } from "@/lib/prisma";
import { checkupDue } from "@/domains/continuity/rules";

/** Owner To do items: automatic charges are paused; the December check-up is waiting. */
export async function listContinuityAttention(now: Date): Promise<ExceptionItem[]> {
  const [settings, done] = await Promise.all([
    prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { chargesPausedAt: true, chargesPausedNote: true } }),
    prisma.yearlyCheckup.findMany({ select: { year: true } }),
  ]);
  const rows: ExceptionItem[] = [];
  if (settings?.chargesPausedAt) {
    rows.push({
      category: "CONTINUITY", severity: "high", title: "Automatic charges and reminders are paused",
      detail: `New automatic charges, late fees, past-due notices and customer reminders are on hold${settings.chargesPausedNote ? ` (${settings.chargesPausedNote})` : ""}. Nothing was refunded or cancelled. Turn them back on from the 'If something happens to me' page when you are ready.`,
      href: "/desk/continuity", since: settings.chargesPausedAt, todoKey: "continuity:charges-paused",
    });
  }
  const { due, year } = checkupDue(now, done.map((d) => d.year));
  if (due) {
    rows.push({
      category: "CONTINUITY", severity: "medium", title: `Your ${year} yearly business check-up is ready`,
      detail: "A short walk through insurance, prices, access, recalls and taxes. Each step opens the screen you need. It changes nothing by itself.",
      href: "/desk/continuity/checkup", since: new Date(Date.UTC(year, 11, 1, 12)), todoKey: `continuity:checkup:${year}`,
    });
  }
  return rows;
}
