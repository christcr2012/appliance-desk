import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BANNED, findViolations, loadAllowlist, visibleText } from "./check-owner-wording.mjs";

test("reads page text, labels and To do text but not code or class names", () => {
  const source = [
    '<p className="remit-box">Pay it</p>',
    '<Field label="Total remittance" />',
    'const note = { title: "Check the taxability matrix", detail: `Fine here` };',
    'const remitCents = 5; // remit is only in code',
  ].join("\n");
  const texts = visibleText(source).map((row) => row.text);
  assert.deepEqual(texts, ["Pay it", "Total remittance", "Check the taxability matrix", "Fine here"]);
});

test("flags every reviewed phrase with its plain replacement", () => {
  const samples = {
    "taxability matrix": "<p>The taxability matrix</p>",
    remit: "<p>Remit the tax</p>",
    election: "<p>Your election</p>",
    cents: '<Field label="Amount (cents)" />',
    "raw status code": "<p>Status: AWAITING_INSPECTION</p>",
    jurisdiction: "<p>Pick a jurisdiction</p>",
    webhook: "<p>Webhook failed</p>",
  };
  for (const [name, source] of Object.entries(samples)) {
    const found = findViolations("x.tsx", source);
    assert.equal(found.length, 1, name);
    assert.match(found[0], /say /);
  }
  assert.ok(BANNED.length >= 10);
});

test("plain wording passes, and an allowlisted phrase needs a file, phrase and written reason", () => {
  assert.deepEqual(findViolations("x.tsx", "<p>Pay the tax you owe by the 20th.</p>"), []);
  const allow = [{ file: "x.tsx", phrase: "jurisdiction", reason: "Quoted from the official Colorado form." }];
  assert.deepEqual(findViolations("x.tsx", "<p>Pick a jurisdiction</p>", allow), []);
  assert.equal(findViolations("y.tsx", "<p>Pick a jurisdiction</p>", allow).length, 1);
  const dir = mkdtempSync(join(tmpdir(), "wording-"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify([{ file: "x.tsx", phrase: "jurisdiction", reason: "short" }]));
  assert.throws(() => loadAllowlist(bad), /written reason/);
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify(allow));
  assert.equal(loadAllowlist(good).length, 1);
  assert.deepEqual(loadAllowlist(join(dir, "missing.json")), []);
});
