import { describePromotionSchedule } from "@/domains/site-content/promotions";
import { draftAssetPath } from "@/domains/site-content/asset-paths";
import type { ValueSummary } from "@/domains/site-content/review";

/** Shows one stored value in plain words (and a small picture where there is one). Used in the editor and in review. */
export function ValueView({ summary, nowIso }: { summary: ValueSummary | null; nowIso: string }) {
  if (!summary) return <span className="text-ink-soft">The starting wording</span>;
  switch (summary.kind) {
    case "text":
      return summary.text ? <span className="whitespace-pre-line break-words">“{summary.text}”</span> : <span className="text-ink-soft">Left empty on purpose</span>;
    case "hidden":
      return <span className="text-ink-soft">Hidden (visitors do not see it)</span>;
    case "link":
      return (
        <span className="break-words">
          Link words “{summary.label}” <span className="text-ink-soft">→ {summary.destination}</span>
        </span>
      );
    case "image":
      return (
        <span className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-only view of a private picture */}
          <img src={draftAssetPath(summary.assetId)} alt="" width={96} height={64} className="h-16 w-24 rounded-control border border-line object-cover" style={{ objectPosition: `${summary.focalX}% ${summary.focalY}%` }} />
          <span className="break-words">{summary.decorative ? "Decoration only (no description read aloud)" : `Description: “${summary.alt}”`}</span>
        </span>
      );
    case "promotion": {
      const promotion = {
        kind: "promotion" as const, title: summary.title, body: summary.body, enabled: summary.enabled,
        ...(summary.startsAtUtc ? { startsAtUtc: summary.startsAtUtc } : {}), ...(summary.endsAtUtc ? { endsAtUtc: summary.endsAtUtc } : {}),
      };
      return (
        <span className="block break-words">
          <strong>{summary.title}</strong>
          {summary.body ? <> — {summary.body}</> : null}
          {summary.cta ? <span className="block text-ink-soft">Button “{summary.cta.label}” → {summary.cta.destination}</span> : null}
          {summary.image ? <span className="block text-ink-soft">Has a picture.</span> : null}
          <span className="block text-ink-soft">{describePromotionSchedule(promotion, new Date(nowIso))}</span>
        </span>
      );
    }
    case "items":
      return <span>A list of {summary.count} entries</span>;
  }
}
