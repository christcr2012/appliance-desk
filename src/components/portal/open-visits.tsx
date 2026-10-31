import { Stepper, type StepperStep } from "@/components/kit";
import { portalLabel } from "@/domains/language/portal-copy";
import type { CustomerLanguage } from "@/domains/language/copy";
import { formatBusinessDate } from "@/lib/business-date";
import { jobKindLabel } from "@/lib/status-labels";

type Visit = { id: string; type: string; status: string; createdAt: Date; scheduledAt: Date | null;
  customerPickupHandoff?: boolean };

/**
 * W-20, restyled for PORTAL-1 section 5.1 on the kit Stepper:
 * Requested -> Scheduled -> Done for each open visit. (The kit Timeline
 * is a timestamped activity feed; a visit's progress steps do not fit
 * its item model, so the steps stay — drawn by the kit Stepper.)
 */
export function OpenVisits({ visits, locale }: { visits: Visit[]; locale: CustomerLanguage }) {
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);
  return (
    <section aria-label={t("Your open visits")} className="rounded-card border border-line bg-surface px-4 py-3.5">
      <h2 className="text-base font-bold text-ink">{t("Your open visits")}</h2>
      <ul className="mt-3 space-y-5">
        {visits.map((visit) => {
          const steps: StepperStep[] = [
            { label: t("Requested"), state: "done", detail: formatBusinessDate(visit.createdAt, locale) },
            visit.scheduledAt
              ? { label: t("Scheduled"), state: "done", detail: formatBusinessDate(visit.scheduledAt, locale) }
              : { label: t("Scheduled"), state: "current", detail: t("Not scheduled yet") },
            { label: t("Done"), state: "waiting" },
          ];
          return (
            <li key={visit.id}>
              <p className="font-semibold text-ink">{jobKindLabel(visit, locale)}</p>
              <div className="mt-2">
                <Stepper steps={steps} label={jobKindLabel(visit, locale)} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
