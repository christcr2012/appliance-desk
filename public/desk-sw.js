/* AR-11: public-only offline frame. NEVER cache desk pages, RSC, API responses, uploads, or user data. */
"use strict";
const CACHE_NAME = "desk-shell-v1";
const SHELL_FILES = ["/offline", "/brand/icon-192.png", "/brand/icon-512.png"];
const isStatic = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/");

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("desk-shell-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    const cache = await caches.open(CACHE_NAME);
    if (!(await cache.match("/offline"))) {
      try { await cache.add("/offline"); } catch { /* next online install will retry */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isStatic(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok && response.type !== "opaque") await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  if (request.mode === "navigate" && url.pathname.startsWith("/desk/")) {
    // Page navigations are NETWORK ONLY. No response from this branch is ever cached.
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match("/offline")) || Response.error();
    }));
  }
  // Every other request (including APIs, RSC and private files) passes through untouched.
});
