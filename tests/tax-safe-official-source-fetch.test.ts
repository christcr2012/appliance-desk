import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: mocks.lookup,
}));
vi.mock("node:https", () => ({
  request: mocks.request,
}));

import { fetchOfficialSourcePage } from "@/domains/tax/safe-official-source-fetch";

type MockResponseOptions = {
  status?: number;
  contentType?: string;
  contentLength?: number;
  chunks?: Array<string | Buffer>;
};

function requestObject(onDestroy?: () => void) {
  const request = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  request.end = vi.fn();
  request.destroy = vi.fn(() => {
    onDestroy?.();
    queueMicrotask(() => request.emit("error", new Error("request destroyed")));
  });
  return request;
}

function installResponse(options: MockResponseOptions = {}) {
  mocks.request.mockImplementationOnce(
    (
      _url: URL,
      _requestOptions: Record<string, unknown>,
      callback: (response: Readable & {
        statusCode?: number;
        headers: Record<string, string>;
      }) => void,
    ) => {
      const response = Readable.from(options.chunks ?? ["ok"]) as Readable & {
        statusCode?: number;
        headers: Record<string, string>;
      };
      response.statusCode = options.status ?? 200;
      response.headers = {
        "content-type": options.contentType ?? "text/plain",
        ...(options.contentLength === undefined
          ? {}
          : { "content-length": String(options.contentLength) }),
      };

      const request = requestObject();
      request.end.mockImplementation(() => {
        queueMicrotask(() => callback(response));
      });
      return request;
    },
  );
}

function publicDns() {
  mocks.lookup.mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
}

describe("T-5b2 safe official-source fetch", () => {
  beforeEach(() => {
    mocks.lookup.mockReset();
    mocks.request.mockReset();
    publicDns();
  });

  it("rejects http and redirect responses", async () => {
    await expect(
      fetchOfficialSourcePage("http://tax.example.gov/page"),
    ).rejects.toThrow("HTTPS");

    installResponse({ status: 302 });
    await expect(
      fetchOfficialSourcePage("https://tax.example.gov/page"),
    ).rejects.toThrow("redirects are not followed");
  });

  it("rejects loopback private link-local local and internal destinations before request", async () => {
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

    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("rejects an unsafe address when DNS returns mixed public and private answers", async () => {
    mocks.lookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ]);

    await expect(
      fetchOfficialSourcePage("https://mixed.example.gov/page"),
    ).rejects.toThrow("non-public address");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("pins the HTTPS connection to the validated public address", async () => {
    installResponse({ chunks: ["Official page"] });

    await fetchOfficialSourcePage("https://tax.example.gov/page");

    const requestOptions = mocks.request.mock.calls[0]?.[1] as {
      family?: number;
      lookup?: (
        hostname: string,
        options: unknown,
        callback: (error: Error | null, address: string, family: number) => void,
      ) => void;
    };
    expect(requestOptions.family).toBe(4);
    const callback = vi.fn();
    requestOptions.lookup?.("tax.example.gov", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("times out a stalled response", async () => {
    mocks.request.mockImplementationOnce(() => requestObject());

    await expect(
      fetchOfficialSourcePage("https://slow.example.gov/page", {
        timeoutMs: 5,
      }),
    ).rejects.toThrow("timed out");
  });

  it("rejects oversized and non-text responses", async () => {
    installResponse({ chunks: ["abcdef"] });
    await expect(
      fetchOfficialSourcePage("https://large.example.gov/page", {
        maxBytes: 4,
      }),
    ).rejects.toThrow("size limit");

    installResponse({
      contentType: "application/octet-stream",
      chunks: ["binary"],
    });
    await expect(
      fetchOfficialSourcePage("https://binary.example.gov/page"),
    ).rejects.toThrow("not HTML or plain text");
  });

  it("normalizes text and hashes the full accepted body while capping stored text", async () => {
    const longTail = "x".repeat(205 * 1024);
    const body = `  First\t line  \r\nSecond   line\r\n${longTail}END\r\n\r\n`;
    const normalized = `First line\nSecond line\n${longTail}END`;
    installResponse({
      contentType: "text/html; charset=utf-8",
      chunks: [body],
    });

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
