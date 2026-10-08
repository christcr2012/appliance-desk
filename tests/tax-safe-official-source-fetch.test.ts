import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: mocks.lookup,
}));

import { fetchOfficialSourcePage } from "@/domains/tax/safe-official-source-fetch";

function publicDns() {
  mocks.lookup.mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
}

describe("T-5b2 safe official-source fetch", () => {
  beforeEach(() => {
    mocks.lookup.mockReset();
    publicDns();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects http and redirect responses", async () => {
    await expect(
      fetchOfficialSourcePage("http://tax.example.gov/page"),
    ).rejects.toThrow("HTTPS");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example.gov/page" },
      }),
    );

    await expect(
      fetchOfficialSourcePage("https://tax.example.gov/page"),
    ).rejects.toThrow("redirects are not followed");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects loopback private link-local local and internal destinations before fetch", async () => {
    const fetchMock = vi.mocked(fetch);

    await expect(
      fetchOfficialSourcePage("https://localhost/page"),
    ).rejects.toThrow("public hostname");
    await expect(
      fetchOfficialSourcePage("https://127.0.0.1/page"),
    ).rejects.toThrow("public hostname");
    await expect(
      fetchOfficialSourcePage("https://service.internal/page"),
    ).rejects.toThrow("public hostname");
    await expect(
      fetchOfficialSourcePage("https://printer.local/page"),
    ).rejects.toThrow("public hostname");

    mocks.lookup.mockResolvedValueOnce([
      { address: "10.10.1.5", family: 4 },
    ]);
    await expect(
      fetchOfficialSourcePage("https://private.example.gov/page"),
    ).rejects.toThrow("non-public address");

    mocks.lookup.mockResolvedValueOnce([
      { address: "169.254.10.5", family: 4 },
    ]);
    await expect(
      fetchOfficialSourcePage("https://linklocal.example.gov/page"),
    ).rejects.toThrow("non-public address");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unsafe address when DNS returns mixed public and private answers", async () => {
    mocks.lookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ]);

    await expect(
      fetchOfficialSourcePage("https://mixed.example.gov/page"),
    ).rejects.toThrow("non-public address");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("times out a stalled response", async () => {
    vi.mocked(fetch).mockImplementationOnce(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    await expect(
      fetchOfficialSourcePage("https://slow.example.gov/page", {
        timeoutMs: 5,
      }),
    ).rejects.toThrow("timed out");
  });

  it("rejects oversized and non-text responses", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("abcdef", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("binary", {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      );

    await expect(
      fetchOfficialSourcePage("https://large.example.gov/page", {
        maxBytes: 4,
      }),
    ).rejects.toThrow("size limit");

    await expect(
      fetchOfficialSourcePage("https://binary.example.gov/page"),
    ).rejects.toThrow("not HTML or plain text");
  });

  it("normalizes text and hashes the full accepted body while capping stored text", async () => {
    const longTail = "x".repeat(205 * 1024);
    const body = `  First\t line  \r\nSecond   line\r\n${longTail}END\r\n\r\n`;
    const normalized = `First line\nSecond line\n${longTail}END`;
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const result = await fetchOfficialSourcePage(
      "https://content.example.gov/page",
    );

    expect(result.contentType).toBe("text/html");
    expect(result.finalUrl).toBe("https://content.example.gov/page");
    expect(result.text.startsWith("First line\nSecond line\n")).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(
      200 * 1024,
    );
    expect(result.text.endsWith("END")).toBe(false);
    expect(result.hash).toBe(
      createHash("sha256").update(normalized, "utf8").digest("hex"),
    );
  });
});
