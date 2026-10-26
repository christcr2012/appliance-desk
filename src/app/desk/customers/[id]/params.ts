// AR-0b: the customer record's URL (docs/build-specs/screens/CUSTOMER-RECORD.md section 2). Bad values fall back to
// the defaults; nothing here throws.
import { z } from "zod";

export const CUSTOMER_RECORD_TABS = ["activity", "rentals", "bills", "visits", "messages", "details"] as const;
export type CustomerRecordTab = (typeof CUSTOMER_RECORD_TABS)[number];
export const ACTIVITY_FILTERS = ["all", "notes", "activity", "communications"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export type CustomerRecordParams = {
  tab?: CustomerRecordTab;
  full: boolean;
  filter: ActivityFilter;
  cursor?: string;
  page: number;
  newAccount: boolean;
  emailSent: boolean;
  from?: string;
};

const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const schema = z.object({
  tab: z.enum(CUSTOMER_RECORD_TABS).optional().catch(undefined),
  full: z.literal("1").optional().catch(undefined),
  filter: z.enum(ACTIVITY_FILTERS).optional().catch(undefined),
  cursor: z.string().max(500).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  newAccount: z.literal("1").optional().catch(undefined),
  emailSent: z.literal("1").optional().catch(undefined),
  from: z.string().max(300).optional().catch(undefined),
});

export function parseCustomerParams(search: Record<string, string | string[] | undefined>): CustomerRecordParams {
  const flat = Object.fromEntries(Object.entries(search).map(([key, value]) => [key, one(value)]));
  const parsed = schema.parse(flat);
  return {
    tab: parsed.tab,
    full: parsed.full === "1",
    filter: parsed.filter ?? "all",
    cursor: parsed.cursor || undefined,
    page: parsed.page ?? 1,
    newAccount: parsed.newAccount === "1",
    emailSent: parsed.emailSent === "1",
    from: parsed.from,
  };
}

const LEGACY_TAB: Record<string, { tab: CustomerRecordTab | null; hash?: string }> = {
  overview: { tab: null },
  properties: { tab: "details" },
  service: { tab: "visits" },
  billing: { tab: "details", hash: "referrals" },
};

/** Old `?tab=` values (before AR-0b) and where they go now, keeping every other param; null when nothing moves. */
export function legacyCustomerRedirect(id: string, search: Record<string, string | string[] | undefined>): string | null {
  const tab = one(search.tab);
  if (typeof tab !== "string") return null;
  const legacy = LEGACY_TAB[tab] ?? ((CUSTOMER_RECORD_TABS as readonly string[]).includes(tab) ? undefined : { tab: null });
  if (!legacy) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const v = one(value);
    if (key !== "tab" && typeof v === "string") params.set(key, v);
  }
  if (legacy.tab) params.set("tab", legacy.tab);
  const query = params.toString();
  return `/desk/customers/${encodeURIComponent(id)}${query ? `?${query}` : ""}${legacy.hash ? `#${legacy.hash}` : ""}`;
}

/** The back link: the list the customer was opened from, when it was a Customers list link; otherwise the plain list. */
export function customersBackHref(from: string | undefined): string {
  if (from && /^\/desk\/customers(?:\?[^#]*)?$/.test(from)) return from;
  return "/desk/customers";
}
