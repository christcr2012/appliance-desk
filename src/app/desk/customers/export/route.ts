import { requireRole } from "@/lib/session";
import { getCustomerExportRows } from "@/domains/customers/list";
import type { CustomerListParams, CustomerSort } from "@/domains/customers/list";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "@/domains/customers/segments";
import { toCsv } from "@/lib/csv";
import { formatMoney } from "@/lib/money-ui";

/**
 * CSV export of the customers the list is showing — CU-1 moved this route
 * onto the list query, so it accepts the same params as /desk/customers
 * (segment, q, city, pm, autopay, service, appliance, since, sort) and
 * exports exactly the filtered set, up to 10,000 rows.
 */
export async function GET(request: Request) {
  await requireRole("OWNER", "ADMIN");
  const url = new URL(request.url);
  const sp = url.searchParams;
  const segmentRaw = sp.get("segment") ?? undefined;
  const segment: CustomerListParams["segment"] =
    segmentRaw === "all"
      ? "all"
      : (CUSTOMER_SEGMENTS as readonly string[]).includes(segmentRaw ?? "")
        ? (segmentRaw as CustomerSegment)
        : undefined;
  const sortRaw = sp.get("sort") ?? undefined;
  const sort = (
    ["attention", "name", "rent-desc", "owed-desc", "newest", "since"].includes(sortRaw ?? "")
      ? sortRaw
      : undefined
  ) as CustomerSort | undefined;
  const ids = (sp.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500);
  const params: CustomerListParams & { ids?: string[] } = {
    ids: ids.length ? ids : undefined,
    segment,
    q: sp.get("q") ?? undefined,
    city: sp.getAll("city"),
    pm: sp.get("pm") === "1" || undefined,
    autopay: sp.get("autopay") === "off" ? "off" : undefined,
    service: sp.get("service") === "1" || undefined,
    appliance: sp.getAll("appliance"),
    since: sp.get("since") ?? undefined,
    sort,
  };

  const rows = await getCustomerExportRows(params);

  const csv = toCsv(
    [
      { key: "name", header: "Name" },
      { key: "email", header: "Email" },
      { key: "phone", header: "Phone" },
      { key: "companyName", header: "Company" },
      { key: "isPropertyManager", header: "Property manager" },
      { key: "city", header: "City" },
      { key: "propertyCount", header: "Properties on file" },
      { key: "agreementCount", header: "Agreements" },
      { key: "monthlyRent", header: "Monthly rent" },
      { key: "owes", header: "Owes" },
      { key: "createdAt", header: "Added" },
    ],
    rows.map((r) => ({
      name: r.name,
      email: r.email,
      phone: r.phone ?? "",
      companyName: r.companyName ?? "",
      isPropertyManager: r.isPropertyManager ? "Yes" : "No",
      city: r.city ?? "",
      propertyCount: r.propertyCount,
      agreementCount: r.activeCount + r.pendingCount + r.endedCount,
      monthlyRent: formatMoney(r.monthlyRentCents ?? 0),
      owes: formatMoney(r.owedCents ?? 0),
      createdAt: r.createdAt.toISOString().slice(0, 10),
    })),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
