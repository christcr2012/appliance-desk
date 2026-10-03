#!/usr/bin/env node
// Repository secret/identifier check. This repo is PUBLIC, so anything committed
// is visible to everyone, permanently. Runs in CI on every change and locally:
//
//   node scripts/check-secrets.mjs          scan every tracked file
//
// It complements gitleaks (which scans credentials across the whole git
// history, see .gitleaks.toml). This script adds repo-specific rules gitleaks
// cannot know about:
//   - Neon / Vercel infrastructure identifiers other than the ones allowed below
//   - database URLs that embed a password and point somewhere other than the
//     local throwaway database
//   - committed .env files and private-key files
//   - long, real-looking live keys (Stripe, Twilio, GitHub, Google, Slack, ...)
// A finding fails the build. To allow a harmless fake, make it obviously fake
// (include "example", "fake", "not-real", "placeholder" or "dummy") or add a
// narrowly-scoped entry to ALLOW below, with a reason.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OBVIOUS_FAKE = /example|fake|not-real|not-for-production|placeholder|dummy|synthetic|redacted|changeme|\.test\b/i;

/** Identifiers that are deliberately committed (preview-only; never production). */
const ALLOWED_IDENTIFIERS = new Set([
  "ep-silent-hill-b7rpraoc", // Neon preview endpoint (src/lib/preview-database-safety.ts allowlist)
  "br-broad-union-b784qy62", // Neon preview branch
  "jolly-term-08991992", // Neon project name (no access without credentials)
]);

const RULES = [
  { name: "Stripe live key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { name: "Stripe webhook secret", re: /\bwhsec_[A-Za-z0-9]{24,}\b/g },
  { name: "Stripe test secret key (real length)", re: /\bsk_test_[A-Za-z0-9]{24,}\b/g },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "Resend API key", re: /\bre_[A-Za-z0-9]{24,}\b/g },
  { name: "Twilio key", re: /\b(?:AC|SK)[a-f0-9]{32}\b/g },
  { name: "Anthropic/OpenAI key", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: "Vercel token", re: /\bvercel_blob_rw_[A-Za-z0-9]{12,}_[A-Za-z0-9]{20,}\b/g },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  {
    name: "Database URL with an embedded password (not the local throwaway database)",
    re: /\bpostgres(?:ql)?:\/\/[^:\s/'"`]+:[^@\s'"`]{3,}@(?!localhost\b|127\.0\.0\.1\b|\$\{|\$\(|<)[^\s'"`/]+/g,
    // Documented placeholder hosts (.env.example) and fixtures that exist to be refused.
    allow: (match) => /@(host(-pooler)?\.region\.|(production|live|other)\.neon\.tech)/.test(match),
  },
  {
    name: "Neon/Vercel infrastructure identifier",
    re: /\b(?:ep|br)-[a-z]+-[a-z]+-[a-z0-9]{8}\b|\bprj_[A-Za-z0-9]{20,}\b|\bteam_[A-Za-z0-9]{20,}\b/g,
    allow: (match) => ALLOWED_IDENTIFIERS.has(match),
  },
];

/** Files that may not be committed at all. */
const FORBIDDEN_PATHS = [
  { re: /(^|\/)\.env(\.[^/]+)?$/, ok: /(^|\/)\.env\.example$/, why: "environment file" },
  { re: /\.(pem|p12|pfx|key|keystore)$/i, ok: /^$/, why: "key/certificate file" },
  { re: /(^|\/)id_(rsa|ed25519|ecdsa)$/, ok: /^$/, why: "SSH private key" },
];

const SKIP_PATH = /(^|\/)(package-lock\.json|node_modules|\.next|playwright-report)\/?|\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|svg)$/i;

/** Scan one file's text. Returns [{ rule, line, preview }]. Pure: no filesystem. */
export function scanText(file, text) {
  const findings = [];
  const lines = text.split("\n");
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(rule.re)) {
        const hit = m[0];
        if (rule.allow?.(hit)) continue;
        if (OBVIOUS_FAKE.test(lines[i])) continue;
        findings.push({ file, rule: rule.name, line: i + 1, preview: `${hit.slice(0, 6)}…(${hit.length} chars)` });
      }
    }
  }
  return findings;
}

export function scanPath(file) {
  const findings = [];
  for (const f of FORBIDDEN_PATHS) {
    if (f.re.test(file) && !f.ok.test(file)) findings.push({ file, rule: `Committed ${f.why}`, line: 0, preview: file });
  }
  return findings;
}

function main() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
  const findings = [];
  for (const file of files) {
    findings.push(...scanPath(file));
    if (SKIP_PATH.test(file)) continue;
    const abs = path.join(root, file);
    let size;
    try {
      size = statSync(abs).size;
    } catch {
      continue; // deleted in the working tree
    }
    if (size > 1_500_000) continue;
    const text = readFileSync(abs, "utf8");
    if (text.includes("\u0000")) continue;
    findings.push(...scanText(file, text));
  }
  if (findings.length) {
    console.error(`check-secrets: ${findings.length} finding(s). This repository is public: remove them (and rotate the credential if it was real).`);
    for (const f of findings) console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}  [${f.preview}]`);
    process.exit(1);
  }
  console.log(`check-secrets: OK (${files.length} tracked files scanned).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
