import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));

import { fetchOfficialSourceJson } from "@/domains/tax/safe-official-source-fetch";

function install(options: { status?: number; contentType?: string; body?: string } = {}) {
  mocks.request.mockImplementationOnce((_url: URL, requestOptions: Record<string, unknown>, callback: (response: unknown) => void) => {
    const response = Readable.from([options.body ?? "[]"]) as Readable & { statusCode?: number; headers: Record<string, string> };
    response.statusCode = options.status ?? 200;
    response.headers = { "content-type": options.contentType ?? "application/json; charset=utf-8" };
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    request.destroy = () => undefined;
    request.end = () => queueMicrotask(() => callback(response));
    (request as unknown as { options: unknown }).options = requestOptions;
    return request;
  });
}

const HOST = "www.saferproducts.gov";

describe("OPS-1 safe fetch for a JSON data source", () => {
  beforeEach(() => {
    mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mocks.request.mockReset();
  });

  it("reads JSON from the one approved host and asks for JSON", async () => {
    install({ body: '[{"RecallID":1}]' });
    const result = await fetchOfficialSourceJson(`https://${HOST}/RestWebServices/Recall?format=json`, { allowedHost: HOST });
    expect(result.json).toEqual([{ RecallID: 1 }]);
    expect((mocks.request.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers.accept).toBe("application/json");
  });

  it("refuses any other host, plain http, and addresses with a password, before touching the network", async () => {
    await expect(fetchOfficialSourceJson("https://evil.example.com/x", { allowedHost: HOST })).rejects.toThrow(/approved list/);
    await expect(fetchOfficialSourceJson(`http://${HOST}/x`, { allowedHost: HOST })).rejects.toThrow(/HTTPS/);
    await expect(fetchOfficialSourceJson(`https://user:pw@${HOST}/x`, { allowedHost: HOST })).rejects.toThrow(/credentials/);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("refuses an answer that is not JSON (an error web page) or is broken JSON", async () => {
    install({ contentType: "text/html", body: "<html>Maintenance</html>" });
    await expect(fetchOfficialSourceJson(`https://${HOST}/x`, { allowedHost: HOST })).rejects.toThrow(/not JSON/);
    install({ body: "{not json" });
    await expect(fetchOfficialSourceJson(`https://${HOST}/x`, { allowedHost: HOST })).rejects.toThrow(/not valid JSON/);
  });

  it("refuses a host that resolves to a private address, and a server error", async () => {
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(fetchOfficialSourceJson(`https://${HOST}/x`, { allowedHost: HOST })).rejects.toThrow(/non-public/);
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    install({ status: 503 });
    await expect(fetchOfficialSourceJson(`https://${HOST}/x`, { allowedHost: HOST })).rejects.toThrow(/HTTP 503/);
  });
});
