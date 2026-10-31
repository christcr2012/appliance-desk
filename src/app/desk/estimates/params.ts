import { z } from "zod";
import {
  QUOTE_SORTS,
  QUOTE_TABS,
  type QuoteListParams,
  type QuoteSort,
  type QuoteTab,
} from "@/domains/estimates/list";

export { QUOTE_SORTS, QUOTE_TABS, type QuoteSort, type QuoteTab };

// AR-4d (QUOTES-MESSAGES spec section 2): the Quotes list URL state. One zod
// schema per KIT 5.1; unknown values fall back to defaults, never throw.
const rawSchema = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  who: z.string().optional(),
  sort: z.string().optional(),
  cursor: z.string().optional(),
});

export function parseQuotesParams(input: {
  [key: string]: string | string[] | undefined;
}): QuoteListParams {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const parsed = rawSchema.parse({
    status: first(input.status),
    q: first(input.q),
    who: first(input.who),
    sort: first(input.sort),
    cursor: first(input.cursor),
  });
  const tab = (QUOTE_TABS as readonly string[]).includes(parsed.status ?? "")
    ? (parsed.status as QuoteTab)
    : "open";
  const sort = (QUOTE_SORTS as readonly string[]).includes(parsed.sort ?? "")
    ? (parsed.sort as QuoteSort)
    : "newest";
  return {
    tab,
    q: parsed.q?.trim() ? parsed.q.trim() : undefined,
    who: parsed.who === "leads" ? "leads" : parsed.who === "customers" ? "customers" : undefined,
    sort,
    cursor: parsed.cursor || undefined,
  };
}

export function quotesHref(
  base: QuoteListParams,
  patch: Partial<QuoteListParams>,
): string {
  const next = { ...base, ...patch };
  const params = new URLSearchParams();
  params.set("status", next.tab ?? "open");
  if (next.q) params.set("q", next.q);
  if (next.who) params.set("who", next.who);
  if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
  if (next.cursor) params.set("cursor", next.cursor);
  return `/desk/estimates?${params.toString()}`;
}
