import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RtcClientEvidence } from "@/app/desk/automations/rtc-client-evidence";
import { DECLARED_RTC_CLIENTS, verifiedRtcClients, type RtcClientReceipt } from "@/mcp/rtc-client-matrix";

const receipt: RtcClientReceipt = {
  client: "Synthetic tested client", status: "PASSED",
  revision: "a1b2c3d4", evidence: ["Owner-observed route receipt in testing"],
};

describe("MCP-9 real client evidence is never inferred from developer tests", () => {
  it("verifies only the one client with a witnessed recorded result", () => {
    // The Official MCP SDK row carries the witnessed 2026-11-04 testing-app trial
    // (PR #846): a direct client completed registration, sign-in, consent, token,
    // whoami, refresh and disconnect at app revision d9c402e5. Every other declared
    // client is still untried or ruled out, so exactly one row may verify.
    const verified = verifiedRtcClients(DECLARED_RTC_CLIENTS);
    expect(verified.map((row) => row.client)).toEqual(["Official MCP SDK"]);
    expect(verified[0]?.revision).toBe("d9c402e5d61d93d612b2777f774226429c25de84");
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

  it("lists the one verified client and none of the untried clients", () => {
    const html = renderToStaticMarkup(<RtcClientEvidence clients={DECLARED_RTC_CLIENTS} />);
    expect(html).toContain(
      "Official MCP SDK — verified on app revision d9c402e5d61d93d612b2777f774226429c25de84");
    expect(html).not.toContain("No real assistant client has been verified yet");
    expect(html).not.toContain("Claude remote connector");
    expect(html).not.toContain("ChatGPT or Codex remote client");
    expect(html).not.toContain("RTC CLI");
  });

  it("shows the truthful empty state when no client carries evidence", () => {
    const html = renderToStaticMarkup(
      <RtcClientEvidence clients={[{ ...receipt, status: "NOT_TRIED" }]} />);
    expect(html).toContain("No real assistant client has been verified yet");
    expect(html).not.toContain("Synthetic tested client");
  });

  it("labels only a fully evidenced client and its tested app revision", () => {
    const html = renderToStaticMarkup(<RtcClientEvidence clients={[receipt,
      { ...receipt, client: "Untried", status: "NOT_TRIED" }]} />);
    expect(html).toContain("Synthetic tested client");
    expect(html).toContain("a1b2c3d4");
    expect(html).not.toContain("Untried");
  });
});
