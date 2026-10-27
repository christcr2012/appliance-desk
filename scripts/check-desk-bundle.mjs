#!/usr/bin/env node
// AR-11: CI regression limit for JS actually requested by each desk App Router page.
// Source: Next.js 16.4 .next/app-build-manifest.json + optional root JS from build-manifest.json.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

export const TEN_KB = 10;
export const MAX_GROWTH = 1.10;

export function routeForEntry(entry) {
  const parts = entry.split("/").filter(Boolean)
    .filter(segment => !segment.startsWith("(") && !segment.startsWith("@") && segment !== "page" && segment !== "layout");
  return "/" + parts.join("/");
}

function routeEntries(pages, page) {
  const parts = page.split("/").filter(Boolean);
  const entries = ["/layout"];
  for (let i = 1; i < parts.length; i++) {
    entries.push("/" + parts.slice(0, i).join("/") + "/layout");
  }
  entries.push(page);
  return entries.filter((entry) => Object.hasOwn(pages, entry));
}

export function pathsByRoute(manifest, bootstrap = []) {
  if (!manifest || typeof manifest.pages !== "object" || !manifest.pages) {
    throw new Error("Missing Next App Router pages in app-build-manifest.json");
  }
  const routes = new Map();
  for (const entry of Object.keys(manifest.pages).sort()) {
    if (!entry.endsWith("/page")) continue;
    const route = routeForEntry(entry);
    if (route !== "/desk" && !route.startsWith("/desk/")) continue;
    if (!routes.has(route)) routes.set(route, new Set(bootstrap.filter((p) => p.endsWith(".js"))));
    const chunks = routes.get(route);
    for (const ancestor of routeEntries(manifest.pages, entry)) {
      for (const chunk of manifest.pages[ancestor]) {
        if (typeof chunk === "string" && chunk.endsWith(".js")) chunks.add(chunk);
      }
    }
  }
  if (routes.size === 0) throw new Error("No /desk pages found: Next manifest format changed");
  return Object.fromEntries([...routes].map(([route, files]) => [route, [...files].sort()]));
}

// Next 16.4.2 Turbopack puts one client-reference manifest beside every compiled App Router page,
// not a root app-build-manifest.json. Discover those real files rather than assume the old location.
export function pathsFromClientReferences(buildDir, bootstrap = []) {
  const appDir = join(buildDir, "server/app");
  const manifests = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name === "page_client-reference-manifest.js") manifests.push(file);
    }
  }
  if (!existsSync(appDir)) throw new Error("Next server/app client manifests are missing");
  visit(appDir);
  const routes = new Map();
  for (const file of manifests.sort()) {
    const name = relative(appDir, file);
    const source = "/" + name.slice(0, -"_client-reference-manifest.js".length);
    const route = routeForEntry(source);
    if (route !== "/desk" && !route.startsWith("/desk/")) continue;
    const sandbox = { __RSC_MANIFEST: {} };
    sandbox.globalThis = sandbox;
    runInNewContext(readFileSync(file, "utf8"), sandbox, { timeout: 1500, filename: file });
    const records = Object.values(sandbox.__RSC_MANIFEST);
    if (!records.length) throw new Error("No RSC client manifest exported by " + file);
    const chunks = routes.get(route) ?? new Set(bootstrap.filter(v => typeof v === "string" && v.endsWith(".js")));
    const collect = (value) => {
      if (typeof value === "string" && value.endsWith(".js")) {
        let chunk = value;
        if (chunk.startsWith("/_next/")) chunk = chunk.slice(7);
        else if (chunk.startsWith("_next/")) chunk = chunk.slice(6);
        if (chunk.startsWith("/")) chunk = chunk.slice(1);
        if (chunk.startsWith("static/")) chunks.add(chunk);
      } else if (Array.isArray(value)) {
        for (const nested of value) collect(nested);
      }
    };
    for (const record of records) {
      for (const module of Object.values(record.clientModules ?? {})) collect(module.chunks);
      collect(record.entryJSFiles);
    }
    routes.set(route, chunks);
  }
  if (!routes.size) throw new Error("No /desk pages found in Next 16.4 client-reference manifests");
  return Object.fromEntries([...routes].sort(([a],[b])=>a.localeCompare(b))
    .map(([route, files]) => [route, [...files].sort()]));
}

export function measureGzipKb(routes, buildDir) {
  const out = {};
  const fileKb = new Map();
  for (const [route, files] of Object.entries(routes)) {
    let total = 0;
    for (const file of files) {
      if (file.startsWith("/") || file.split("/").includes("..") || !file.startsWith("static/")) {
        throw new Error(`Unsafe or unknown client chunk for ${route}: ${file}`);
      }
      if (!fileKb.has(file)) {
        const absolute = join(buildDir, file);
        if (!existsSync(absolute)) throw new Error(`Missing JavaScript chunk for ${route}: ${file}`);
        fileKb.set(file, gzipSync(readFileSync(absolute)).length / 1024);
      }
      total += fileKb.get(file);
    }
    if (!files.length) throw new Error(`No JavaScript chunks for ${route}`);
    out[route] = Number(total.toFixed(2));
  }
  return out;
}

export function baselines(measured) {
  return Object.fromEntries(Object.entries(measured).sort(([a], [b]) => a.localeCompare(b))
    .map(([route, kb]) => [route, Math.max(TEN_KB, Math.ceil(kb / TEN_KB) * TEN_KB)]));
}

export function validateBudget(measured, budget) {
  const failures = [];
  for (const [route, size] of Object.entries(measured)) {
    const baseline = budget[route];
    if (!Number.isFinite(baseline) || baseline <= 0) {
      failures.push(`${route}: new route has no committed JavaScript budget`);
    } else if (size > baseline * MAX_GROWTH) {
      failures.push(`${route}: ${size.toFixed(2)} KB gzip exceeds ${baseline} KB budget by more than 10%`);
    }
  }
  for (const route of Object.keys(budget)) {
    if (!Object.hasOwn(measured, route)) failures.push(`${route}: committed budget has no built page`);
  }
  return failures;
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function run() {
  const buildDir = resolve(process.env.NEXT_BUILD_DIR ?? ".next");
  const appPath = join(buildDir, "app-build-manifest.json");
  const buildManifestPath = join(buildDir, "build-manifest.json");
  const bootstrap = existsSync(buildManifestPath)
    ? readJson(buildManifestPath).rootMainFiles ?? [] : [];
  const routes = existsSync(appPath)
    ? pathsByRoute(readJson(appPath), bootstrap)
    : pathsFromClientReferences(buildDir, bootstrap);
  const sizeByRoute = measureGzipKb(routes, buildDir);
  const budgetPath = resolve("scripts/desk-bundle-budget.json");
  if (process.argv.includes("--baseline")) {
    const rounded = baselines(sizeByRoute);
    writeFileSync(budgetPath, JSON.stringify(rounded, null, 2) + "\n", "utf8");
    const b64 = Buffer.from(JSON.stringify(rounded, null, 2) + "\n").toString("base64");
    console.log("AR11_BUDGET_BEGIN");
    for (let i = 0; i < b64.length; i += 1200) console.log("AR11_BUDGET_CHUNK:" + b64.slice(i, i + 1200));
    console.log("AR11_BUDGET_END");
  } else {
    if (!existsSync(budgetPath)) throw new Error("No committed JS bundle baseline. Generate once with --baseline.");
    const failed = validateBudget(sizeByRoute, readJson(budgetPath));
    if (failed.length) throw new Error("Desk JavaScript bundle regression:\n" + failed.join("\n"));
  }
  const peak = Object.entries(sizeByRoute).sort((a, b) => b[1] - a[1])[0];
  console.log(`Desk bundle: ${Object.keys(sizeByRoute).length} pages, largest ${peak[0]} ${peak[1]} KB gzip`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
