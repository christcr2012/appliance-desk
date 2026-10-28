import { describe, expect, it, vi } from "vitest";
import { fetchGitHubEvidence } from "@/domains/agent-control/repair-cases";

describe("MCP-6 bounded, fixed-repository evidence", () => {
  it("refuses foreign URLs and unexpected paths without calling the network", async () => {
    const fetcher = vi.fn();
    for (const path of ["/repos/foreign/example/pulls/1", "//evil.test/pulls/1",
      "/pulls/1/../../private", "/pulls/0", "/pulls/1?state=merged",
      "/commits/abc/check-runs"]) {
      await expect(fetchGitHubEvidence(path, fetcher)).rejects.toMatchObject({
        code: "INVALID_GITHUB_EVIDENCE_PATH",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("only requests this repo, with no credentials or redirect-following", async () => {
    const fetcher = vi.fn(async () => Response.json({ number: 9 }));
    await expect(fetchGitHubEvidence<{ number: number }>("/pulls/9", fetcher)).resolves.toEqual({ number: 9 });
    expect(fetcher).toHaveBeenCalledWith("https://api.github.com/repos/christcr2012/appliance-desk/pulls/9",
      expect.objectContaining({ redirect: "error", credentials: "omit", cache: "no-store" }));
  });

  it("rejects claimed oversized responses and server redirects", async () => {
    await expect(fetchGitHubEvidence("/pulls/4", async () =>
      new Response("{}", { headers: { "content-length": "1000001" } })))
      .rejects.toMatchObject({ code: "GITHUB_EVIDENCE_TOO_LARGE" });
    await expect(fetchGitHubEvidence("/pulls/4", async () =>
      new Response(null, { status: 302, headers: { location: "https://other.example/" } })))
      .rejects.toMatchObject({ code: "GITHUB_EVIDENCE_NOT_VERIFIED" });
  });

  it("rejects invalid JSON and an unbounded body without trusting length", async () => {
    await expect(fetchGitHubEvidence("/pulls/4", async () => new Response("not json")))
      .rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INVALID" });
    await expect(fetchGitHubEvidence("/pulls/4", async () =>
      new Response("x".repeat(1_000_100))))
      .rejects.toMatchObject({ code: "GITHUB_EVIDENCE_TOO_LARGE" });
  });
});
