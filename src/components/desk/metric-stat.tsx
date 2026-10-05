import Link from "next/link";
import { METRICS, type MetricKey } from "@/domains/reports/definitions";

/** The small "How this is counted" text for one number. Collapsed by default so the page stays calm. */
export function MetricHelp({ metric, params = {} }: { metric: MetricKey; params?: Record<string, string> }) {
  const def = METRICS[metric];
  return (
    <details className="mt-2 text-xs text-ink-soft">
      <summary className="cursor-pointer font-medium text-primary underline">How this is counted</summary>
      <dl className="mt-2 space-y-1">
        <div>
          <dt className="inline font-semibold">Type: </dt>
          <dd className="inline">{def.kind === "ACTUAL" ? "Actual (recorded facts)" : "Estimate (worked out, not recorded)"}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Dates: </dt>
          <dd className="inline">{def.dateBasis}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">How: </dt>
          <dd className="inline">{def.calculation}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Comes from: </dt>
          <dd className="inline">{def.sources.join("; ")}</dd>
        </div>
      </dl>
      <Link className="mt-1 inline-block text-primary underline" href={def.drillHref(params)}>
        See the records behind it
      </Link>
    </details>
  );
}

/** A number with its label and definition, both taken from METRICS. */
export function MetricStat({
  metric,
  value,
  tone = "default",
  params,
}: {
  metric: MetricKey;
  value: string;
  tone?: "default" | "warning" | "good";
  params?: Record<string, string>;
}) {
  const def = METRICS[metric];
  const toneClass =
    tone === "warning" ? "border-amber-300 bg-amber-50" : tone === "good" ? "border-line bg-primary-soft" : "border-line bg-white";
  return (
    <div className={`rounded-lg border p-5 ${toneClass}`}>
      <p className="text-sm text-ink-soft">
        {def.label}
        {def.kind === "ESTIMATE" && <span className="ml-2 rounded-full bg-canvas-alt px-2 py-0.5 text-xs text-ink-soft">Estimate</span>}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "good" ? "text-primary-dark" : "text-ink"}`}>{value}</p>
      <MetricHelp metric={metric} params={params} />
    </div>
  );
}
