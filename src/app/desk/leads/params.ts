import { z } from "zod";
import type { LeadQueueParams } from "@/domains/leads/queue";
import type { LeadStage } from "@/domains/leads/stage";

/**
 * LEADS.md section 2: the leads queue URL params, parsed from the raw search
 * params. Returns `LeadQueueParams` plus the AR-12 "Property managers" view
 * flag (`pm`). An absent `stage` means "not specified": the page applies the
 * count-based default (New when it has leads, else Contacted) — except when
 * `follow` is set, where no stage filter applies at all.
 *
 * Old links keep working: `?status=NEW|CONTACTED|CONVERTED|LOST` maps to the
 * matching stage, `?view=awaiting-reply` to Quote sent, `?view=no-next-task`
 * to Contacted sorted next-up, and `?page=` is ignored. An explicit `stage`
 * (or `sort`) always wins over the legacy mapping.
 */
export type LeadsPageParams = LeadQueueParams & { pm?: boolean };

type RawParams = Record<string, string | string[] | undefined>;

const STAGES = ["new", "contacted", "quoted", "won", "lost"] as const;
const SORTS = ["next-up", "newest", "score", "value", "activity"] as const;
const CREATED = ["today", "week", "month"] as const;
const FOLLOW = ["today", "week"] as const;

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

const multi = (v: string | string[] | undefined): string[] => {
  const all = (Array.isArray(v) ? v : [v]).flatMap((x) => (x ?? "").split(","));
  return [...new Set(all.map((x) => x.trim()).filter(Boolean))];
};

// Every field catches its own bad value: a hand-typed or stale URL must
// degrade to the defaults, never fail the page.
const schema = z.object({
  stage: z.enum(STAGES).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  owner: z.string().min(1).optional().catch(undefined),
  source: z.array(z.string()).optional().catch(undefined),
  area: z.enum(["in", "out"]).optional().catch(undefined),
  high: z.literal("1").optional().catch(undefined),
  pm: z.literal("1").optional().catch(undefined),
  appliance: z.array(z.string()).optional().catch(undefined),
  created: z.enum(CREATED).optional().catch(undefined),
  quote: z.literal("1").optional().catch(undefined),
  follow: z.enum(FOLLOW).optional().catch(undefined),
  sort: z.enum(SORTS).catch("next-up"),
  cursor: z.string().min(1).optional().catch(undefined),
});

const LEGACY_STATUS: Record<string, LeadStage> = {
  NEW: "new",
  CONTACTED: "contacted",
  CONVERTED: "won",
  LOST: "lost",
};

/** Serialize params back to a /desk/leads href (cursor paging, tabs, sheet links). */
export function leadsHref(
  params: LeadsPageParams,
  overrides: Partial<Record<string, string | null>> = {},
): string {
  const q = new URLSearchParams();
  const set = (key: string, value: string | undefined) => {
    if (value) q.set(key, value);
  };
  set("stage", params.stage);
  set("q", params.q);
  set("owner", params.owner);
  if (params.source?.length) q.set("source", params.source.join(","));
  set("area", params.area);
  if (params.highValue) q.set("high", "1");
  if (params.pm) q.set("pm", "1");
  if (params.appliance?.length) q.set("appliance", params.appliance.join(","));
  set("created", params.created);
  if (params.hasQuote) q.set("quote", "1");
  set("follow", params.follow);
  if (params.sort && params.sort !== "next-up") q.set("sort", params.sort);
  set("cursor", params.cursor);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) q.delete(key);
    else if (value !== undefined) q.set(key, value);
  }
  const s = q.toString();
  return s ? `/desk/leads?${s}` : "/desk/leads";
}

export function parseLeadsParams(raw: RawParams): LeadsPageParams {
  const parsed = schema.parse({
    stage: first(raw.stage),
    q: first(raw.q),
    owner: first(raw.owner),
    source: multi(raw.source),
    area: first(raw.area),
    high: first(raw.high),
    pm: first(raw.pm),
    appliance: multi(raw.appliance),
    created: first(raw.created),
    quote: first(raw.quote),
    follow: first(raw.follow),
    sort: first(raw.sort),
    cursor: first(raw.cursor),
  });

  let stage = parsed.stage;
  let sort = parsed.sort;
  if (!stage) {
    const legacy = LEGACY_STATUS[first(raw.status)?.toUpperCase() ?? ""];
    if (legacy) stage = legacy;
  }
  const view = first(raw.view);
  if (!stage && view === "awaiting-reply") stage = "quoted";
  if (view === "no-next-task") {
    if (!stage) stage = "contacted";
    if (!first(raw.sort)) sort = "next-up";
  }

  return {
    ...(stage ? { stage } : {}),
    ...(parsed.q ? { q: parsed.q } : {}),
    ...(parsed.owner ? { owner: parsed.owner } : {}),
    ...(parsed.source?.length ? { source: parsed.source } : {}),
    ...(parsed.area ? { area: parsed.area } : {}),
    ...(parsed.high ? { highValue: true } : {}),
    ...(parsed.pm ? { pm: true } : {}),
    ...(parsed.appliance?.length ? { appliance: parsed.appliance } : {}),
    ...(parsed.created ? { created: parsed.created } : {}),
    ...(parsed.quote ? { hasQuote: true } : {}),
    ...(parsed.follow ? { follow: parsed.follow } : {}),
    sort,
    ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
  };
}
