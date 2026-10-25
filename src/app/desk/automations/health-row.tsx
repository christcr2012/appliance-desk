// MCP-1: one System health row. Shows the state's label next to its colour, what it means, the job's usual time in
// Colorado time, and — when something needs doing — a plain explanation, "What to do", a link and a reference.
// It never receives the raw error text: only typed codes reach this component.
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/kit";
import { Card } from "@/components/ui";
import type { AutomationHealthRow } from "@/domains/automation/health";
import { HEALTH_PRESENTATION } from "@/domains/automation/health-states";
import { failureExplanation } from "@/domains/automation/failures";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

export type HealthRowData = Pick<AutomationHealthRow,
  "ruleKey" | "label" | "explanation" | "state" | "dueAt" | "nextDueAt" | "graceMinutes" | "missingEnv" |
  "lastSuccessAt" | "lastFailure" | "latest">;

function when(value: Date | null): string {
  if (!value) return "Never";
  return `${formatBusinessDate(value)} at ${formatBusinessTime(value)}`;
}

type Help = { explain: string; next: string; href: string; linkLabel: string; reference: string | null };

/** The plain help for a row, or null when nothing needs doing. Exported for tests. */
export function helpFor(row: HealthRowData): Help | null {
  switch (row.state) {
    case "failing": {
      const plain = failureExplanation(row.latest?.code ?? row.lastFailure?.code);
      return {
        explain: plain.explain, next: plain.next, href: plain.href ?? "/desk/automations#system-issues",
        linkLabel: plain.href ? "Open the setting" : "See problems the system found",
        reference: row.latest?.ref ?? row.lastFailure?.ref ?? null,
      };
    }
    case "late":
      return {
        explain: `It should have finished by ${when(row.dueAt)} (plus ${row.graceMinutes} minutes' grace) and hasn't.`,
        next: "Nothing needs undoing. Check the problems list for a matching note; this clears by itself after the next good run.",
        href: "/desk/automations#system-issues", linkLabel: "See problems the system found", reference: null,
      };
    case "unknown":
      return {
        explain: "The last run started but never reported whether it finished.",
        next: "Check the records it works on before doing anything by hand; it tries again at its next usual time.",
        href: "/desk/automations#system-issues", linkLabel: "See problems the system found",
        reference: row.latest?.ref ?? null,
      };
    case "unconfigured":
      return {
        explain: `Missing setting ${row.missingEnv.length === 1 ? "name" : "names"}: ${row.missingEnv.join(", ")}.`,
        next: "Ask whoever manages hosting to add it. Only the name is shown here; never paste a setting's value into the app.",
        href: "/desk/settings?section=integrations", linkLabel: "Open connection settings", reference: null,
      };
    default:
      return null;
  }
}

export function HealthRow({ row, children }: { row: HealthRowData; children?: ReactNode }) {
  const look = HEALTH_PRESENTATION[row.state];
  const help = helpFor(row);
  const anchor = row.ruleKey.replaceAll(":", "-");
  return (
    <div id={anchor} data-testid={`health-row-${anchor}`} data-state={row.state} className="scroll-mt-4">
      <Card title={row.label} description={row.explanation} actions={<StatusPill tone={look.tone} label={look.label} />}>
        <p className="text-sm text-ink">{look.meaning}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-soft">Usual time (Colorado)</dt>
            <dd className="font-semibold text-ink">{formatBusinessTime(row.nextDueAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Next run expected</dt>
            <dd className="font-semibold text-ink">{when(row.nextDueAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Last success</dt>
            <dd className="font-semibold text-ink">{when(row.lastSuccessAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Last failure</dt>
            <dd className="font-semibold text-ink">{row.lastFailure ? when(row.lastFailure.at) : "None recorded"}</dd>
          </div>
        </dl>
        {help && (
          <div className="mt-4 space-y-1 rounded-control border border-line bg-subtle p-3 text-sm text-ink">
            <p>{help.explain}</p>
            <p><span className="font-semibold">What to do:</span> {help.next}</p>
            <Link href={help.href} data-help-link={anchor} className="inline-block font-semibold underline">{help.linkLabel}</Link>
            {help.reference && <p className="text-ink-soft">Reference {help.reference}</p>}
          </div>
        )}
        {children}
      </Card>
    </div>
  );
}

/** Every state's label, colour and meaning, so the colours are never the only signal. */
export function HealthLegend() {
  return (
    <section aria-labelledby="health-legend-heading" className="mb-6 rounded-card border border-line bg-surface p-4">
      <h2 id="health-legend-heading" className="text-base font-bold text-ink">What each status means</h2>
      <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {Object.entries(HEALTH_PRESENTATION).map(([state, look]) => (
          <li key={state} className="flex items-start gap-2" data-testid={`health-legend-${state}`}>
            <StatusPill tone={look.tone} label={look.label} />
            <span className="text-ink-soft">{look.meaning}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
