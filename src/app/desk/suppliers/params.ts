import type { SupplierListStatus } from "@/domains/purchasing/suppliers-page";

/**
 * AR-6b section 7: the Suppliers page's URL params — Active/Archived
 * tabs, the name/contact search and the (name, id) cursor
 * getSuppliersPage pages on. The cursor rides in one opaque `cursor`
 * value, tagged so another list's cursor is ignored, not misread.
 */

export const SUPPLIERS_TABS: { value: SupplierListStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

export type SuppliersParams = {
  status: SupplierListStatus;
  q: string;
  cursor?: { name: string; id: string };
};

export function encodeSuppliersCursor(cursor: { name: string; id: string }): string {
  return Buffer.from(JSON.stringify({ k: "s", ...cursor }), "utf8").toString("base64url");
}

export function parseSuppliersParams(raw: Record<string, string | undefined>): SuppliersParams {
  const status: SupplierListStatus = raw.status === "archived" ? "archived" : "active";
  let cursor: SuppliersParams["cursor"];
  if (raw.cursor?.trim()) {
    try {
      const parsed = JSON.parse(
        Buffer.from(raw.cursor.trim(), "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      if (parsed.k === "s" && typeof parsed.name === "string" && typeof parsed.id === "string") {
        cursor = { name: parsed.name, id: parsed.id };
      }
    } catch {
      cursor = undefined;
    }
  }
  return { status, q: raw.q?.trim() ?? "", cursor };
}

export function suppliersHref(params: SuppliersParams, extra?: { cursor?: string }): string {
  const search = new URLSearchParams();
  if (params.status !== "active") search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  if (extra?.cursor) search.set("cursor", extra.cursor);
  const qs = search.toString();
  return qs ? `/desk/suppliers?${qs}` : "/desk/suppliers";
}
