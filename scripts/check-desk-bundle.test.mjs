import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeForEntry, pathsByRoute, pathsFromClientReferences, measureGzipKb, baselines, validateBudget } from "./check-desk-bundle.mjs";

test("route groups and dynamic page segments preserve visible routes", () => {
  assert.equal(routeForEntry("/(owner)/desk/(ops)/customers/[id]/page"), "/desk/customers/[id]");
  assert.equal(routeForEntry("/desk/today/page"), "/desk/today");
});

test("layout and bootstrap chunks count once per route, and other private pages are excluded", () => {
  const manifest = { pages: {
    "/layout": ["static/chunks/root.js"],
    "/desk/layout": ["static/chunks/root.js", "static/chunks/desk.js"],
    "/desk/today/page": ["static/chunks/today.js", "static/chunks/desk.js"],
    "/desk/customers/page": ["static/chunks/customers.js"],
    "/account/page": ["static/chunks/customer-private.js"],
  }};
  const routes = pathsByRoute(manifest, ["static/chunks/boot.js"]);
  assert.deepEqual(routes["/desk/today"], ["static/chunks/boot.js", "static/chunks/desk.js", "static/chunks/root.js", "static/chunks/today.js"]);
  assert.deepEqual(routes["/desk/customers"], ["static/chunks/boot.js", "static/chunks/customers.js", "static/chunks/desk.js", "static/chunks/root.js"]);
  assert.equal(routes["/account"], undefined);
});

test("gzip actual JS bytes, round first baseline to next 10 KB, and fail at >110%", () => {
  const root = mkdtempSync(join(tmpdir(), "desk-js-test-"));
  try {
    mkdirSync(join(root, "static/chunks"), { recursive: true });
    writeFileSync(join(root, "static/chunks/desk.js"), "const longString = '" + "abcdefghij".repeat(1024) + "';");
    const measurements = measureGzipKb({ "/desk/today": ["static/chunks/desk.js"] }, root);
    assert.ok(measurements["/desk/today"] > 0);
    const first = baselines(measurements);
    assert.ok(first["/desk/today"] % 10 === 0);
    assert.deepEqual(validateBudget({ "/desk/today": first["/desk/today"] * 1.1 }, first), []);
    assert.equal(validateBudget({ "/desk/today": first["/desk/today"] * 1.11 }, first).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("uncovered new routes, stale baselines, missing and unsafe JS chunks fail", () => {
  assert.equal(validateBudget({ "/desk/new": 10 }, { "/desk/today": 100 }).length, 2);
  assert.throws(() => pathsByRoute({ pages: { "/": ["static/chunks/root.js"] } }), /No \/desk pages/);
  assert.throws(() => measureGzipKb({"/desk/today": ["../../secret.js"]}, "/tmp"), /Unsafe/);
  assert.throws(() => measureGzipKb({"/desk/today": ["static/chunks/missing.js"]}, "/tmp"), /Missing JavaScript/);
});

test("Next 16 client-reference page manifests provide actual page and shared JS", () => {
  const root = mkdtempSync(join(tmpdir(), "desk-rsc-"));
  try {
    const dir = join(root, "server/app/desk/today");
    mkdirSync(dir, { recursive: true });
    const js = 'globalThis.__RSC_MANIFEST=globalThis.__RSC_MANIFEST||{};' +
      'globalThis.__RSC_MANIFEST["/desk/today/page"]=' +
      JSON.stringify({ clientModules: {
        "components/app-shell": { chunks: ["static/chunks/desk.js", "static/chunks/desk.js"] },
        "components/today": { chunks: [12, "/_next/static/chunks/today.js"] },
      } }) + ';';
    writeFileSync(join(dir, "page_client-reference-manifest.js"), js);
    assert.deepEqual(pathsFromClientReferences(root, ["static/chunks/bootstrap.js"])["/desk/today"],
      ["static/chunks/bootstrap.js", "static/chunks/desk.js", "static/chunks/today.js"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
