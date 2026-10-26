import Link from "next/link";
import { Timeline, type TimelineItem } from "@/components/kit";
import { listRuleHistory } from "@/domains/rules/reads";
import { describeRuleValue, ruleDef, ruleStateLabel, type RuleKey } from "@/domains/rules/registry";

function actorFor(origin: string): string {
  if (origin === "OWNER") return "Owner";
  if (origin === "PROFESSIONAL") return "CPA or attorney";
  if (origin === "OFFICIAL_WATCH") return "Official page";
  return "Research";
}

/** Every version of one rule, newest first. Undone versions stay visible, marked undone. */
export async function RuleHistory({ ruleKey, currentVersionId, closeHref }: {
  ruleKey: RuleKey;
  currentVersionId: string | null;
  closeHref: string;
}) {
  const def = ruleDef(ruleKey);
  const history = await listRuleHistory(ruleKey);
  const now = new Date();
  const items: TimelineItem[] = history.map((version) => {
    const undone = version.undoneAt !== null;
    const isCurrent = version.id === currentVersionId;
    const value = describeRuleValue(ruleKey, version.value);
    return {
      id: version.id,
      at: version.effectiveFrom,
      title: `${value} — from ${version.effectiveFrom.toISOString().slice(0, 10)}${undone ? " (undone)" : ""}`,
      detail: ruleStateLabel(version) +
        (version.checkedOn ? ` · Checked ${version.checkedOn.toISOString().slice(0, 10)}` : "") +
        (undone && version.undoneAt ? ` · Undone ${version.undoneAt.toISOString().slice(0, 10)}` : ""),
      tone: undone ? "danger" : isCurrent ? "good" : version.effectiveFrom > now ? "info" : "neutral",
      actor: actorFor(version.origin),
      href: version.sourceUrl ?? undefined,
    };
  });
  return (
    <section aria-label={`History for ${def.title}`} className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">History: {def.title}</h2>
        <Link href={closeHref} className="text-sm underline">Close history</Link>
      </div>
      <p className="text-sm text-muted-foreground">{def.explain}</p>
      <Timeline items={items} emptyLabel="No versions yet" now={now} />
    </section>
  );
}
