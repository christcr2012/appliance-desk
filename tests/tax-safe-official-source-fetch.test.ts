import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
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

import {
  createPinnedLookup,
  fetchOfficialSourcePage,
} from "@/domains/tax/safe-official-source-fetch";

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
    await expect(
      fetchOfficialSourcePage("https://user:secret@tax.example.gov/page"),
    ).rejects.toThrow("credentials");

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

    mocks.lookup.mockResolvedValueOnce([
      { address: "100.64.0.10", family: 4 },
    ]);
    await expect(
      fetchOfficialSourcePage("https://cgnat.example.gov/page"),
    ).rejects.toThrow("non-public address");

    mocks.lookup.mockResolvedValueOnce([
      { address: "192.88.99.1", family: 4 },
    ]);
    await expect(
      fetchOfficialSourcePage("https://relay-6to4.example.gov/page"),
    ).rejects.toThrow("non-public address");

    mocks.lookup.mockResolvedValueOnce([
      { address: "::1", family: 6 },
    ]);
    await expect(
      fetchOfficialSourcePage("https://ipv6-loopback.example.gov/page"),
    ).rejects.toThrow("non-public address");

    mocks.lookup.mockResolvedValueOnce([
      { address: "fe80::1", family: 6 },
    ]);
    await expect(
      fetchOfficialSourcePage("https://ipv6-linklocal.example.gov/page"),
    ).rejects.toThrow("non-public address");

    mocks.lookup.mockResolvedValueOnce([
      { address: "fd00::1", family: 6 },
    ]);
    await expect(
      fetchOfficialSourcePage("https://ipv6-ula.example.gov/page"),
    ).rejects.toThrow("non-public address");

    mocks.lookup.mockResolvedValueOnce([
      { address: "::ffff:7f00:1", family: 6 },
    ]);
    await expect(
      fetchOfficialSourcePage("https://ipv4-mapped.example.gov/page"),
    ).rejects.toThrow("non-public address");

    for (const [label, address] of [
      ["site-local", "fec0::1"],
      ["local-nat64", "64:ff9b:1::c0a8:1"],
      ["documentation", "2001:db8::1"],
      ["deprecated-6to4", "2002:c0a8:101::1"],
    ] as const) {
      mocks.lookup.mockResolvedValueOnce([{ address, family: 6 }]);
      await expect(
        fetchOfficialSourcePage(`https://${label}.example.gov/page`),
      ).rejects.toThrow("non-public address");
    }

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
    expect(callback).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("allows a global-unicast IPv6 answer and pins that exact address", async () => {
    mocks.lookup.mockResolvedValueOnce([
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    installResponse({ chunks: ["Official page"] });

    await fetchOfficialSourcePage("https://ipv6.example.gov/page");

    const requestOptions = mocks.request.mock.calls[0]?.[1] as {
      family?: number;
      lookup?: (
        hostname: string,
        options: unknown,
        callback: (error: Error | null, address: string, family: number) => void,
      ) => void;
    };
    expect(requestOptions.family).toBe(6);
    const callback = vi.fn();
    requestOptions.lookup?.("ipv6.example.gov", {}, callback);
    expect(callback).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith(
      null,
      "2606:4700:4700::1111",
      6,
    );
  });

  it("uses the deferred pinned lookup through Node's real HTTPS socket setup", async () => {
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Could not allocate the local transport test port.");
    }

    const { request: realHttpsRequest } =
      await vi.importActual<typeof import("node:https")>("node:https");

    try {
      await new Promise<void>((resolve, reject) => {
        let request: ReturnType<typeof realHttpsRequest>;
        try {
          request = realHttpsRequest(
            {
              hostname: "pinned.example.test",
              port: address.port,
              method: "GET",
              lookup: createPinnedLookup("127.0.0.1", 4),
              rejectUnauthorized: false,
            },
            (response) => {
              response.resume();
              resolve();
            },
          );
        } catch (cause) {
          reject(cause);
          return;
        }

        request.once("error", (cause) => {
          if (
            cause instanceof TypeError &&
            cause.message.includes("setServername")
          ) {
            reject(cause);
            return;
          }
          // The local plain TCP peer intentionally cannot complete TLS.
          resolve();
        });
        request.end();
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("includes DNS resolution in the request deadline", async () => {
    mocks.lookup.mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    await expect(
      fetchOfficialSourcePage("https://dns-stall.example.gov/page", {
        timeoutMs: 5,
      }),
    ).rejects.toThrow("timed out");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("times out a stalled response", async () => {
    mocks.request.mockImplementationOnce(() => requestObject());

    await expect(
      fetchOfficialSourcePage("https://slow.example.gov/page", {
        timeoutMs: 5,
      }),
    ).rejects.toThrow("timed out");
  });

  it("destroys the socket immediately for a rejected response", async () => {
    const requestRef = requestObject();
    let responseDestroy: ReturnType<typeof vi.fn> | null = null;

    mocks.request.mockImplementationOnce(
      (
        _url: URL,
        _requestOptions: Record<string, unknown>,
        callback: (response: Readable & {
          statusCode?: number;
          headers: Record<string, string>;
        }) => void,
      ) => {
        const response = new Readable({ read() {} }) as Readable & {
          statusCode?: number;
          headers: Record<string, string>;
        };
        response.statusCode = 302;
        response.headers = { "content-type": "text/plain" };
        const originalDestroy = response.destroy.bind(response);
        responseDestroy = vi.fn((error?: Error) => originalDestroy(error));
        response.destroy = responseDestroy as typeof response.destroy;

        requestRef.end.mockImplementation(() => {
          queueMicrotask(() => callback(response));
        });
        return requestRef;
      },
    );

    await expect(
      fetchOfficialSourcePage("https://redirect.example.gov/page"),
    ).rejects.toThrow("redirects are not followed");

    expect(responseDestroy).toHaveBeenCalled();
    expect(requestRef.destroy).toHaveBeenCalled();
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
