// AR-3 (MONEY-AREA 2): the Payments list URL is the screen's state. Unknown or bad values fall back to the
// defaults; nothing here throws (same contract as the Bills params).
import { z } from "zod";
import { PAYMENT_METHODS, type PaymentTab } from "@/domains/billing/payment-tabs";
import type { PaymentSort, PaymentWhenPreset, PaymentsParams } from "@/domains/billing/payments-list";

const TABS = ["received", "failed", "held", "deposits", "waiting"] as const satisfies readonly PaymentTab[];
const SORTS = ["newest", "oldest", "amount-desc"] as const satisfies readonly PaymentSort[];
const PRESETS = ["this-month", "last-month", "last-30", "custom"] as const satisfies readonly PaymentWhenPreset[];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const schema = z.object({
  status: z.enum(TABS).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  method: z.string().optional().catch(undefined),
  when: z.enum(PRESETS).optional().catch(undefined),
  from: z.string().regex(DAY).optional().catch(undefined),
  to: z.string().regex(DAY).optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  cursor: z.string().max(400).optional().catch(undefined),
});

export const PAYMENT_SORT_LABEL: Record<PaymentSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  "amount-desc": "Largest first",
};

export function parsePaymentsParams(search: Record<string, string | string[] | undefined>): PaymentsParams {
  const parsed = schema.parse({
    status: one(search.status),
    q: one(search.q),
    method: one(search.method),
    when: one(search.when),
    from: one(search.from),
    to: one(search.to),
    sort: one(search.sort),
    cursor: one(search.cursor),
  });
  const methods = (parsed.method ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => (PAYMENT_METHODS as readonly string[]).includes(m));
  return {
    status: parsed.status ?? "received",
    q: parsed.q || undefined,
    method: methods.length ? methods : undefined,
    when: parsed.when ? { preset: parsed.when, from: parsed.from, to: parsed.to } : undefined,
    sort: parsed.sort ?? "newest",
    cursor: parsed.cursor || undefined,
  };
}

export function paymentsHref(params: PaymentsParams, cursor?: string | null): string {
  const sp = new URLSearchParams();
  if (params.status !== "received") sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  if (params.method?.length) sp.set("method", params.method.join(","));
  if (params.when) {
    sp.set("when", params.when.preset);
    if (params.when.from) sp.set("from", params.when.from);
    if (params.when.to) sp.set("to", params.when.to);
  }
  if (params.sort !== "newest") sp.set("sort", params.sort);
  if (cursor) sp.set("cursor", cursor);
  const query = sp.toString();
  return query ? `/desk/payments?${query}` : "/desk/payments";
}
