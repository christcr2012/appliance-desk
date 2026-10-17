import { Card } from "@/components/ui";
import { portalLabel } from "@/domains/language/portal-copy";
import type { CustomerLanguage } from "@/domains/language/copy";
import { formatBusinessDate } from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";

type Visit = { id: string; type: string; status: string; createdAt: Date; scheduledAt: Date | null };

/** W-20: Requested -> Scheduled -> Done for each open visit. */
export function OpenVisits({ visits, locale }: { visits: Visit[]; locale: CustomerLanguage }) {
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);
  return (
    <Card title={t("Your open visits")}>
      <ul className="space-y-4">
        {visits.map((visit) => (
          <li key={visit.id}>
            <p className="font-semibold text-ink">{jobTypeLabel(visit.type as Parameters<typeof jobTypeLabel>[0], locale)}</p>
            <ol className="mt-1 space-y-1 text-sm text-ink-soft">
              <li>✓ {t("Requested")} · {formatBusinessDate(visit.createdAt, locale)}</li>
              <li>
                {visit.scheduledAt ? "✓ " : "○ "}
                {t("Scheduled")} · {visit.scheduledAt ? formatBusinessDate(visit.scheduledAt, locale) : t("Not scheduled yet")}
              </li>
              <li>○ {t("Done")}</li>
            </ol>
          </li>
        ))}
      </ul>
    </Card>
  );
}
