import { ButtonLink, Card } from "@/components/ui";
import type { SetupChecklist } from "@/domains/setup/checklist";

/**
 * "Get set up": shown to the owner on Today until every step is done (W-7). Each row says "Done ✓" or the one
 * thing still missing and opens the exact screen that fixes it. The status is written in words, never colour
 * alone. It only reads; it never changes a setting.
 */
export function SetupCard({ checklist }: { checklist: SetupChecklist }) {
  if (checklist.complete) return null;
  return (
    <div className="mb-6" data-testid="setup-card">
      <Card
        title="Get set up"
        description={`${checklist.doneCount} of ${checklist.total} steps done. Work through them in order so the business is ready to run.`}
      >
        <ol className="divide-y divide-line">
          {checklist.steps.map((step, index) => (
            <li
              key={step.key}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1 basis-64">
                <p className="font-semibold text-ink">
                  {index + 1}. {step.title}
                  <span className="ml-2 text-sm font-medium text-ink-soft">
                    {step.done ? "Done ✓" : "Not done yet"}
                  </span>
                </p>
                <p className="mt-1 text-sm text-ink-soft">{step.detail}</p>
              </div>
              <ButtonLink href={step.href} variant={step.done ? "quiet" : "secondary"}>
                {step.done ? "Review" : "Finish this"}
                <span className="sr-only">, {step.title.toLowerCase()}</span>
              </ButtonLink>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
