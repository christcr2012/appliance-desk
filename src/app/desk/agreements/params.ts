import { z } from "zod";
import {
  RENTAL_SORTS,
  RENTAL_TABS,
  type RentalSort,
  type RentalTab,
  type RentalsParams,
} from "@/domains/agreements/rentals-list";

export {
  RENTAL_SORTS,
  RENTAL_TABS,
  type RentalSort,
  type RentalTab,
  type RentalsParams,
};

// AR-4a (RENTALS spec section 2): the Rentals list URL state. One zod schema
// per KIT 5.1; unknown values fall back to defaults, never throw. Old links
// keep working: upper-case enum statuses (?status=ACTIVE) map to the new tab
// values and ?page= is ignored (cursor paging replaced offset paging).
const LEGACY_STATUS: Record<string, RentalTab> = {
  ACTIVE: "active",
  AWAITING_SIGNATURE: "signing",
  SCHEDULED: "starting",
  DRAFT: "drafts",
  ENDED: "ended",
  CANCELLED: "cancelled",
};

const rawSchema = z.object({
  status: z.string().optional(),
  starts: z.string().optional(),
  ends: z.string().optional(),
  q: z.string().optional(),
  sort: z.string().optional(),
  cursor: z.string().optional(),
});

function tabOf(raw: string | undefined): RentalTab {
  if (!raw) return "active";
  if ((RENTAL_TABS as readonly string[]).includes(raw)) return raw as RentalTab;
  return LEGACY_STATUS[raw] ?? "active";
}

export function parseRentalsParams(input: {
  [key: string]: string | string[] | undefined;
}): RentalsParams {
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const parsed = rawSchema.parse({
    status: first(input.status),
    starts: first(input.starts),
    ends: first(input.ends),
    q: first(input.q),
    sort: first(input.sort),
    cursor: first(input.cursor),
  });
  const q = parsed.q?.trim().slice(0, 120);
  return {
    status: tabOf(parsed.status),
    starts:
      parsed.starts === "this-week" || parsed.starts === "this-month"
        ? parsed.starts
        : undefined,
    ends:
      parsed.ends === "this-week" ||
      parsed.ends === "this-month" ||
      parsed.ends === "ending-soon"
        ? parsed.ends
        : undefined,
    q: q ? q : undefined,
    sort: (RENTAL_SORTS as readonly string[]).includes(parsed.sort ?? "")
      ? (parsed.sort as RentalSort)
      : "newest",
    cursor: parsed.cursor || undefined,
  };
}

/** Serialize params back into a query string (status always explicit). */
export function rentalsHref(
  base: RentalsParams,
  patch: Partial<RentalsParams>,
): string {
  const next = { ...base, ...patch };
  const params = new URLSearchParams();
  params.set("status", next.status);
  if (next.starts) params.set("starts", next.starts);
  if (next.ends) params.set("ends", next.ends);
  if (next.q) params.set("q", next.q);
  if (next.sort !== "newest") params.set("sort", next.sort);
  if (next.cursor) params.set("cursor", next.cursor);
  return `/desk/agreements?${params.toString()}`;
}
