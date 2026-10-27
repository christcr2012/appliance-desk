import Link from "next/link";
import {
  DataTable,
  EmptyState,
  ScreenHeader,
  StatusPill,
  Toaster,
  Toolbar,
  type Column,
  type FilterDef,
  type MenuItem,
} from "@/components/kit";
import { requireRole } from "@/lib/session";
import { getRuleTimingSettings, getWatchOfficialPages, listRuleCards, type RuleCard } from "@/domains/rules/reads";
import { describeRuleValue, ruleDef, ruleStateLabel } from "@/domains/rules/registry";
import { parseRulesParams, RULE_AREA_OPTIONS } from "./params";
import { RuleHistory } from "./rule-history";
import { RuleChangeSheet } from "./rule-change-sheet";
import { TimingSection } from "./timing-section";
import { WatchSection } from "./watch-section";
import { undoRuleVersionFormAction } from "./actions";

export const metadata = { title: "Tax and fee rules", robots: { index: false, follow: false } };

type RuleRow = RuleCard & { def: ReturnType<typeof ruleDef> };

const AREA_FILTER: FilterDef = {
  kind: "multi",
  param: "area",
  label: "Area",
  options: [...RULE_AREA_OPTIONS],
};

function stateTone(origin: string): "neutral" | "good" | "attention" | "info" | "danger" {
  if (origin === "PROFESSIONAL") return "good";
  if (origin === "OFFICIAL_WATCH") return "info";
  if (origin === "OWNER") return "neutral";
  return "attention";
}

function dateOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function withParams(base: string, set: Record<string, string | null>): string {
  const params = new URLSearchParams(base);
  for (const [key, value] of Object.entries(set)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `/desk/sales-tax/rules?${query}` : "/desk/sales-tax/rules";
}

const columns: Column<RuleRow>[] = [
  {
    key: "rule",
    header: "Rule",
    cell: (row) => (
      <div>
        <p className="font-semibold">{row.def.title}</p>
        <p className="text-sm text-muted-foreground">{row.def.explain}</p>
      </div>
    ),
  },
  {
    key: "now",
    header: "Now",
    cell: (row) => row.current
      ? <p>{describeRuleValue(row.key, row.current.value)} <span className="text-muted-foreground">since {dateOf(row.current.version.effectiveFrom)}</span></p>
      : <p className="text-muted-foreground">Not set</p>,
  },
  {
    key: "next",
    header: "Next",
    cell: (row) => row.next
      ? <p>{describeRuleValue(row.key, row.next.value)} <span className="text-muted-foreground">from {dateOf(row.next.effectiveFrom)}</span></p>
      : <p className="text-muted-foreground">—</p>,
  },
  {
    key: "source",
    header: "Source",
    cell: (row) => {
      const version = row.current?.version ?? row.next;
      if (!version) return <p className="text-muted-foreground">—</p>;
      return (
        <p>
          {version.sourceUrl
            ? <Link href={version.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Source</Link>
            : "Research notes"}
          {version.checkedOn ? <span className="text-muted-foreground"> · checked {dateOf(version.checkedOn)}</span> : null}
        </p>
      );
    },
  },
  {
    key: "state",
    header: "State",
    cell: (row) => row.current
      ? <StatusPill label={ruleStateLabel(row.current.version)} tone={stateTone(row.current.version.origin)} />
      : <StatusPill label="Not set" tone="attention" />,
  },
];

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole("OWNER", "ADMIN");
  const owner = session.user.role === "OWNER";
  const rawParams = await searchParams;
  const params = parseRulesParams(rawParams);
  const [cards, timing, watchEnabled] = await Promise.all([listRuleCards(), getRuleTimingSettings(), getWatchOfficialPages()]);
  const now = new Date();
  const search = new URLSearchParams({
    ...(params.q ? { q: params.q } : {}),
    ...(params.areas.length ? { area: params.areas.join(",") } : {}),
  }).toString();
  const rows: RuleRow[] = cards
    .filter((card) => params.areas.length === 0 || params.areas.includes(ruleDef(card.key).area))
    .filter((card) => {
      if (!params.q) return true;
      const hay = `${ruleDef(card.key).title} ${ruleDef(card.key).explain}`.toLowerCase();
      return hay.includes(params.q.toLowerCase());
    })
    .map((card) => ({ ...card, def: ruleDef(card.key) }));
  const byKey = new Map(cards.map((card) => [card.key, { ...card, def: ruleDef(card.key) }]));

  function rowActions(row: RuleRow): MenuItem[] {
    const items: MenuItem[] = [
      { kind: "link", label: "History", href: withParams(search, { history: row.key, change: null }) },
    ];
    if (!owner) return items;
    items.push({ kind: "link", label: "Change…", href: withParams(search, { change: row.key, history: null }) });
    // Undo targets the next version: the version in force today has already
    // started, so only a change that has not started yet can be undone.
    const upcoming = row.next;
    if (upcoming && (upcoming.origin === "OWNER" || upcoming.origin === "PROFESSIONAL") && upcoming.effectiveFrom > now) {
      items.push({
        kind: "form",
        label: "Undo this change",
        action: undoRuleVersionFormAction,
        fields: { versionId: upcoming.id },
        confirm: {
          title: "Undo this change?",
          summary: "The change never takes effect. Earlier versions stay in history.",
          confirmLabel: "Undo change",
          danger: true,
        },
        danger: true,
        successMessage: "Change undone.",
      });
    }
    return items;
  }

  const historyCard = params.historyKey ? byKey.get(params.historyKey) ?? null : null;
  const changeCard = owner && params.changeKey ? byKey.get(params.changeKey) ?? null : null;

  // The desk shell already renders the page's <main> landmark; this page
  // must not add a second one (axe: landmark-no-duplicate-main).
  return (
    <div className="space-y-5">
      <ScreenHeader title="Tax and fee rules" count={rows.length} list />
      <Toolbar
        search={{ param: "q", placeholder: "Search rules", label: "Search tax rules" }}
        filters={[AREA_FILTER]}
      />
      <DataTable<RuleRow>
        caption="Tax and fee rules"
        rows={rows}
        rowKey={(row) => row.key}
        columns={columns}
        mobileCard={(row) => (
          <div className="space-y-1">
            <p className="font-semibold">{row.def.title}</p>
            <p className="text-sm">{row.current ? describeRuleValue(row.key, row.current.value) : "Not set"}</p>
            {row.current ? <StatusPill label={ruleStateLabel(row.current.version)} tone={stateTone(row.current.version.origin)} /> : null}
          </div>
        )}
        rowActions={rowActions}
        empty={<EmptyState title="No rules match" />}
      />
      {historyCard && (
        <RuleHistory
          ruleKey={historyCard.key}
          currentVersionId={historyCard.current?.version.id ?? null}
          closeHref={withParams(search, { history: null })}
        />
      )}
      {owner && <TimingSection percent={timing.percent} marginBusinessDays={timing.marginBusinessDays} />}
      {owner && <WatchSection enabled={watchEnabled} />}
      {changeCard && (
        <RuleChangeSheet
          ruleKey={changeCard.key}
          // Only plain data crosses to this client component: the full
          // RuleDef carries a zod schema (a class) and a describe
          // function, which React refuses to pass from a Server
          // Component (the Change sheet never opened; the server logged
          // "Only plain objects ... can be passed to Client Components").
          def={{
            title: changeCard.def.title,
            explain: changeCard.def.explain,
            change: changeCard.def.change,
            fields: changeCard.def.fields,
          }}
          current={changeCard.current?.value ?? null}
        />
      )}
      <Toaster />
    </div>
  );
}
