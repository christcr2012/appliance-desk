import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RtcClientEvidence } from "@/app/desk/automations/rtc-client-evidence";
import { DECLARED_RTC_CLIENTS, verifiedRtcClients, type RtcClientReceipt } from "@/mcp/rtc-client-matrix";

const receipt: RtcClientReceipt = {
  client: "Synthetic tested client", status: "PASSED",
  revision: "a1b2c3d4", evidence: ["Owner-observed route receipt in testing"],
};

describe("MCP-9 real client evidence is never inferred from developer tests", () => {
  it("keeps all current declared clients unverified", () => {
    expect(verifiedRtcClients(DECLARED_RTC_CLIENTS)).toEqual([]);
    expect(DECLARED_RTC_CLIENTS.some((row) => row.status === "NOT_TRIED")).toBe(true);
  });

  it("requires a genuine recorded result, source revision and nonempty evidence", () => {
    const rows: RtcClientReceipt[] = [
      receipt,
      { ...receipt, client: "Untried", status: "NOT_TRIED" },
      { ...receipt, client: "No release", revision: null },
      { ...receipt, client: "No proof", evidence: [] },
      { ...receipt, client: "Blank proof", evidence: [" "] },
      { ...receipt, client: "Bad SHA", revision: "release unknown" },
      { ...receipt, client: "  " },
    ];
    expect(verifiedRtcClients(rows)).toEqual([receipt]);
  });

  it("shows the truthful empty state rather than listing untried clients", () => {
    const html = renderToStaticMarkup(<RtcClientEvidence clients={DECLARED_RTC_CLIENTS} />);
    expect(html).toContain("No real assistant client has been verified yet");
    expect(html).not.toContain("Official MCP SDK — verified");
  });

  it("labels only a fully evidenced client and its tested app revision", () => {
    const html = renderToStaticMarkup(<RtcClientEvidence clients={[receipt,
      { ...receipt, client: "Untried", status: "NOT_TRIED" }]} />);
    expect(html).toContain("Synthetic tested client");
    expect(html).toContain("a1b2c3d4");
    expect(html).not.toContain("Untried");
  });
});
