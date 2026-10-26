import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync("public/desk-sw.js", "utf8");

type WorkerEvent = {
  request?: { url: string; method: string; mode: string };
  respondWith?: (promise: Promise<Response>) => void;
  waitUntil?: (promise: Promise<unknown>) => void;
};

function worker() {
  const listeners: Record<string, (event: WorkerEvent) => void> = {};
  const put = vi.fn(async () => {});
  const match = vi.fn(async (url: unknown) =>
    url === "/offline" ? new Response("<h1>You're offline</h1>", { headers: { "content-type": "text/html" } }) : undefined);
  const cache = { match, put, add: vi.fn(async () => {}), addAll: vi.fn(async () => {}) };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ["desk-shell-v0"]), delete: vi.fn(async () => true) };
  const fetch = vi.fn(async () => new Response("online"));
  const self = { location: { origin: "https://example.test" }, addEventListener: (name: string, cb: (event: WorkerEvent) => void) => { listeners[name] = cb; },
    skipWaiting: vi.fn(), clients: { claim: vi.fn() } };
  runInNewContext(script, { self, caches, fetch, URL, Response });
  function fire(url: string, mode = "cors", method = "GET") {
    let answer: Promise<Response> | undefined;
    listeners.fetch({ request: { url, mode, method }, respondWith: (p: Promise<Response>) => { answer = p; } });
    return answer;
  }
  return { fire, fetch, put, match, caches, cache, listeners };
}

describe("AR-11 public-only service worker", () => {
  it("never intercepts or caches RSC, API, uploads or other origins", () => {
    const w = worker();
    for (const url of [
      "https://example.test/desk/customers/a?_rsc=abc",
      "https://example.test/api/customers",
      "https://example.test/api/photos/abc",
      "https://example.test/desk/secret",
      "https://not-our-site.test/_next/static/file.js",
    ]) expect(w.fire(url)).toBeUndefined();
    expect(w.put).not.toHaveBeenCalled();
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it("uses network-only navigation and returns the public offline page on failure", async () => {
    const w = worker();
    await expect(w.fire("https://example.test/desk/customers/a", "navigate")).resolves.toBeDefined();
    expect(w.put).not.toHaveBeenCalled();
    w.fetch.mockRejectedValueOnce(new Error("network down"));
    const response = await w.fire("https://example.test/desk/customers/b", "navigate");
    expect(await response?.text()).toContain("You're offline");
    expect(w.put).not.toHaveBeenCalled();
  });

  it("caches only hashed static assets and public brand files", async () => {
    const w = worker();
    await w.fire("https://example.test/_next/static/chunks/main.js");
    await w.fire("https://example.test/brand/badge.svg");
    expect(w.put).toHaveBeenCalledTimes(2);
    expect(w.fire("https://example.test/offline", "navigate")).toBeUndefined();
    expect(w.put).toHaveBeenCalledTimes(2);
  });

  it("preloads the offline page and deletes only old desk shell caches", async () => {
    const w = worker();
    let install: Promise<unknown> | undefined;
    w.listeners.install({ waitUntil: (p: Promise<unknown>) => { install = p; } });
    await install;
    expect(w.cache.addAll).toHaveBeenCalledWith(["/offline", "/brand/icon-192.png", "/brand/icon-512.png"]);
    let activate: Promise<unknown> | undefined;
    w.listeners.activate({ waitUntil: (p: Promise<unknown>) => { activate = p; } });
    await activate;
    expect(w.caches.delete).toHaveBeenCalledWith("desk-shell-v0");
  });
});
