import acceptance from "../../docs/mcp/acceptance.json";

/** Human-observed client evidence, never inferred from CI or a saved connection. */
export type RtcClientReceipt = {
  client: string;
  status: string;
  revision: string | null;
  evidence: readonly unknown[];
};

export const DECLARED_RTC_CLIENTS: readonly RtcClientReceipt[] = acceptance.rtcClients;

/** Only a reviewed release receipt can produce a public "verified" client label. */
export function verifiedRtcClients(rows: readonly RtcClientReceipt[]): RtcClientReceipt[] {
  return rows.filter((row) =>
    row.status === "PASSED" &&
    row.client.trim().length > 0 &&
    typeof row.revision === "string" &&
    /^[a-f0-9]{7,40}$/.test(row.revision) &&
    Array.isArray(row.evidence) &&
    row.evidence.some((item) => item !== null && item !== undefined &&
      (typeof item !== "string" || item.trim().length > 0)),
  );
}
