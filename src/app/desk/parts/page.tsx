import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getPartsList, getPartsTypeOptions } from "@/domains/purchasing/parts-list";
import { EmptyState } from "@/components/ui";
import { ScreenHeader, StatusTabs, Toolbar, type FilterDef } from "@/components/kit";
import { Toaster } from "@/components/kit/toaster";
import { PARTS_TABS, encodePartsCursor, parsePartsParams, partsHref } from "./params";
import { PartsList } from "./parts-list";

export const metadata = { title: "Parts" };

/**
 * AR-6b section 6: the Parts page on getPartsList alone — the AR-6
 * role-shaped cursor read. Staff see stock counts and low-stock pills;
 * the finance columns and edit controls exist only for OWNER/ADMIN
 * (their staff DTOs carry no price keys to render in the first place).
 */
export default async function PartsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const raw = await searchParams;
  // Stale ?open= links (the old table's side-panel convention) go straight
  // to the part's record, as before.
  if (raw.open) redirect(`/desk/parts/${encodeURIComponent(raw.open)}`);
  const role = session.user.role;
  const canManage = role === "OWNER" || role === "ADMIN";
  const params = parsePartsParams(raw);

  const [list, types] = await Promise.all([
    getPartsList(
      { status: params.status, q: params.q, type: params.type, cursor: params.cursor },
      { role },
    ),
    getPartsTypeOptions({ role }),
  ]);

  const filters: FilterDef[] = [
    {
      kind: "select",
      param: "type",
      label: "Type",
      options: types.map((t) => ({ value: t.id, label: t.name })),
    },
  ];
  const filtered = Boolean(params.q || params.type);

  return (
    <div>
      <Toaster />
      <ScreenHeader
        title="Parts"
        list
        primary={
          canManage && params.status === "low" && list.rows.length > 0
            ? { kind: "link", label: "New order", href: "/desk/purchase-orders/new" }
            : undefined
        }
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Every part you&apos;ve logged, grouped by model number. Add new parts from an appliance record for that model.
      </p>

      <div className="mb-4">
        <StatusTabs
          label="Filter parts by stock"
          param="status"
          current={params.status}
          items={PARTS_TABS.map((t) => ({ value: t.value, label: t.label }))}
        />
      </div>

      <Toolbar
        search={{ param: "q", placeholder: "Model number, part number or name", label: "Search parts" }}
        filters={filters}
      />

      {list.rows.length === 0 ? (
        filtered || params.status === "archived" ? (
          <EmptyState title="No parts here" description="Nothing matches. Clear the search or filters to see more parts." />
        ) : params.status === "low" ? (
          <EmptyState title="Nothing is low right now" description="Parts at or below the amount you flag them at will show here." />
        ) : (
          <EmptyState
            title="No parts logged yet"
            description="Add parts from an appliance's Parts tab."
          />
        )
      ) : (
        <PartsList
          rows={list.rows}
          canManage={canManage}
          nextHref={list.nextCursor ? partsHref(params, { cursor: encodePartsCursor(list.nextCursor) }) : null}
        />
      )}
    </div>
  );
}
