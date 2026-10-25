// AR-0b: the Money › Bills URL is the screen's state (docs/build-specs/screens/MONEY-BILLS.md section 1). Unknown or
// bad values fall back to the defaults; nothing here throws.
import { z } from "zod";
import type { BillDuePreset, BillSort, BillType, BillsParams } from "@/domains/billing/bills-list";
import type { BillTab } from "@/domains/billing/bill-status";

export type BillsView = "by-customer" | "deposits" | "waiting";
export type BillsPageParams = BillsParams & { view?: BillsView; open?: string };

const TABS = ["open", "past-due", "paid", "closed", "drafts"] as const satisfies readonly BillTab[];
const SORTS = ["due-asc", "due-desc", "owed-desc", "customer-asc"] as const satisfies readonly BillSort[];
const TYPES = ["rent", "sale", "other"] as const satisfies readonly BillType[];
const PRESETS = ["this-month", "last-month", "last-30", "custom"] as const satisfies readonly BillDuePreset[];
const VIEWS = ["by-customer", "deposits", "waiting"] as const satisfies readonly BillsView[];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = z.string().optional().catch(undefined);
const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const schema = z.object({
  status: z.enum(TABS).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  type: text,
  due: z.enum(PRESETS).optional().catch(undefined),
  from: z.string().regex(DAY).optional().catch(undefined),
  to: z.string().regex(DAY).optional().catch(undefined),
  autopay: z.enum(["on", "off"]).optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  view: z.enum(VIEWS).optional().catch(undefined),
  open: z.string().max(100).regex(/^[A-Za-z0-9_-]+$/).optional().catch(undefined),
  cursor: z.string().max(400).optional().catch(undefined),
});

export const BILL_SORT_LABEL: Record<BillSort, string> = {
  "due-asc": "Oldest due first",
  "due-desc": "Newest first",
  "owed-desc": "Most owed first",
  "customer-asc": "Customer A–Z",
};

export function defaultBillSort(status: BillTab): BillSort {
  return status === "paid" || status === "closed" ? "due-desc" : "due-asc";
}

/** Old `?filter=` links (before AR-0b) and where each one goes now; null when there is nothing to move. */
export function legacyBillsRedirect(search: Record<string, string | string[] | undefined>): string | null {
  const filter = one(search.filter);
  if (typeof filter !== "string") return null;
  const target =
    filter === "delinquent"
      ? "status=past-due"
      : filter === "statements"
        ? "view=by-customer"
        : filter === "deposits"
          ? "view=deposits"
          : filter === "waiting"
            ? "view=waiting"
            : "";
  return target ? `/desk/billing?${target}` : null;
}

export function parseBillsParams(search: Record<string, string | string[] | undefined>): BillsPageParams {
  const flat = Object.fromEntries(Object.entries(search).map(([key, value]) => [key, one(value)]));
  // The old "processing" tab value now means Open (BILL-1 brings back a tab for bills being confirmed).
  if (flat.status === "processing") flat.status = "open";
  const parsed = schema.parse(flat);
  const status: BillTab = parsed.status ?? "open";
  const type = (parsed.type ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is BillType => (TYPES as readonly string[]).includes(value));
  const due =
    parsed.due === "custom"
      ? parsed.from || parsed.to
        ? { preset: "custom" as const, from: parsed.from, to: parsed.to }
        : undefined
      : parsed.due
        ? { preset: parsed.due }
        : undefined;
  return {
    status,
    q: parsed.q || undefined,
    type: type.length ? [...new Set(type)] : undefined,
    due,
    autopay: parsed.autopay,
    sort: parsed.sort ?? defaultBillSort(status),
    view: parsed.view,
    open: parsed.open,
    cursor: parsed.cursor,
  };
}

/** True when a search or any filter narrows the list (the empty state then offers "Clear filters"). */
export function hasBillFilters(params: BillsPageParams): boolean {
  return Boolean(params.q || params.type?.length || params.due || params.autopay);
}
