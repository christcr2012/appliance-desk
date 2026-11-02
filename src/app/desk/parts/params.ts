import type { PartsListStatus } from "@/domains/purchasing/parts-list";

/**
 * AR-6b section 6: the Parts page's URL params — stock tabs, search, the
 * appliance-type filter and the (modelNumber, id) cursor getPartsList
 * pages on. The cursor rides in one opaque `cursor` value.
 */

export const PARTS_TABS: { value: PartsListStatus; label: string }[] = [
  { value: "in-stock", label: "In stock" },
  { value: "low", label: "Low stock" },
  { value: "archived", label: "Archived" },
];

export type PartsParams = {
  status: PartsListStatus;
  q: string;
  type?: string;
  cursor?: { modelNumber: string; id: string };
};

export function encodePartsCursor(cursor: { modelNumber: string; id: string }): string {
  return Buffer.from(JSON.stringify({ k: "part", ...cursor }), "utf8").toString("base64url");
}

export function parsePartsParams(raw: Record<string, string | undefined>): PartsParams {
  const status: PartsListStatus =
    raw.status === "low" || raw.status === "archived" ? raw.status : "in-stock";
  let cursor: PartsParams["cursor"];
  if (raw.cursor?.trim()) {
    try {
      const parsed = JSON.parse(
        Buffer.from(raw.cursor.trim(), "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      if (
        parsed.k === "part" &&
        typeof parsed.modelNumber === "string" &&
        typeof parsed.id === "string"
      ) {
        cursor = { modelNumber: parsed.modelNumber, id: parsed.id };
      }
    } catch {
      cursor = undefined;
    }
  }
  return {
    status,
    q: raw.q?.trim() ?? "",
    type: raw.type?.trim() ? raw.type.trim() : undefined,
    cursor,
  };
}

export function partsHref(params: PartsParams, extra?: { cursor?: string }): string {
  const search = new URLSearchParams();
  if (params.status !== "in-stock") search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  if (params.type) search.set("type", params.type);
  if (extra?.cursor) search.set("cursor", extra.cursor);
  const qs = search.toString();
  return qs ? `/desk/parts?${qs}` : "/desk/parts";
}
