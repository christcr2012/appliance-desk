import { z } from "zod";
import {
  CUSTOMER_SORTS,
  type CustomerListParams,
  type CustomerSort,
} from "@/domains/customers/list";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "@/domains/customers/segments";

export { CUSTOMER_SORTS, type CustomerSort };

// AR-4c (CUSTOMERS spec sections 5-6): the Customers list URL state. One zod
// schema per KIT 5.1; unknown values fall back to defaults, never throw. Old
// links keep working: ?status=active maps to the Active segment, ?kind=pm to
// the property-manager filter, and ?page= is ignored (cursor paging replaced
// offset paging).
const rawSchema = z.object({
  segment: z.string().optional(),
  status: z.string().optional(),
  kind: z.string().optional(),
  q: z.string().optional(),
  city: z.union([z.string(), z.array(z.string())]).optional(),
  pm: z.string().optional(),
  autopay: z.string().optional(),
  service: z.string().optional(),
  appliance: z.union([z.string(), z.array(z.string())]).optional(),
  sincePreset: z.string().optional(),
  sort: z.string().optional(),
  cursor: z.string().optional(),
});

function listOf(v: string | string[] | undefined): string[] {
  if (!v) return [];
  const parts = (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(","));
  return [...new Set(parts.map((s) => s.trim()).filter(Boolean))].slice(0, 25);
}

const DAY = 86_400_000;

/** "Customer since" presets become an ISO date (Denver today minus the span). */
function sinceOf(preset: string | undefined, now: Date): string | undefined {
  const days = preset === "30d" ? 30 : preset === "90d" ? 90 : preset === "12m" ? 365 : undefined;
  if (!days) return undefined;
  const d = new Date(now.getTime() - days * DAY);
  return d.toISOString().slice(0, 10);
}

export function parseCustomersParams(
  input: { [key: string]: string | string[] | undefined },
  now = new Date(),
): CustomerListParams {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const parsed = rawSchema.parse({
    segment: first(input.segment),
    status: first(input.status),
    kind: first(input.kind),
    q: first(input.q),
    city: input.city,
    pm: first(input.pm),
    autopay: first(input.autopay),
    service: first(input.service),
    appliance: input.appliance,
    sincePreset: first(input.sincePreset),
    sort: first(input.sort),
    cursor: first(input.cursor),
  });
  const segmentRaw = parsed.segment ?? (parsed.status === "active" ? "active" : undefined);
  const segment: CustomerListParams["segment"] =
    segmentRaw === "all"
      ? "all"
      : (CUSTOMER_SEGMENTS as readonly string[]).includes(segmentRaw ?? "")
        ? (segmentRaw as CustomerSegment)
        : undefined;
  const q = parsed.q?.trim().slice(0, 120);
  return {
    segment,
    q: q ? q : undefined,
    city: listOf(parsed.city),
    pm: parsed.pm !== undefined || parsed.kind === "pm" ? true : undefined,
    autopay: parsed.autopay !== undefined ? "off" : undefined,
    service: parsed.service !== undefined ? true : undefined,
    appliance: listOf(parsed.appliance),
    since: sinceOf(parsed.sincePreset, now),
    sort: (CUSTOMER_SORTS as readonly string[]).includes(parsed.sort ?? "")
      ? (parsed.sort as CustomerSort)
      : undefined,
    cursor: parsed.cursor || undefined,
  };
}

/** Serialize params back into a query string (segment always explicit). */
export function customersHref(
  base: CustomerListParams & { sincePreset?: string },
  patch: Partial<CustomerListParams> & { sincePreset?: string },
): string {
  const next = { ...base, ...patch };
  const params = new URLSearchParams();
  params.set("segment", next.segment ?? "active");
  if (next.q) params.set("q", next.q);
  for (const c of next.city ?? []) params.append("city", c);
  if (next.pm) params.set("pm", "1");
  if (next.autopay === "off") params.set("autopay", "off");
  if (next.service) params.set("service", "1");
  for (const a of next.appliance ?? []) params.append("appliance", a);
  if (next.sincePreset) params.set("sincePreset", next.sincePreset);
  if (next.sort && next.sort !== "attention") params.set("sort", next.sort);
  if (next.cursor) params.set("cursor", next.cursor);
  return `/desk/customers?${params.toString()}`;
}
