# CI-MAINT-2026-10-26-allowlist — durable scanner allowlist for registry identifier keys

**Approved scope:** Chris's October 26 "fill in the gaps" assignment to Lane 6 while
VAULT-1 waits on CMP-1: convert the recurring secret-scan false positives for the
compliance obligation-key pattern from per-commit fingerprints to a durable
pattern/path-based allowlist, stating the reason in the PR (AGENTS.md section 1).
**Base:** `main` at `238f7a573ddb410b43a754bbdea079caf5a74ca7` (after CMP-1 merged).
**Risk boundary:** scanner configuration only. No application behavior, no test
changes, no budget or coverage change. The generic-api-key rule itself is not
edited; the default rule set is untouched apart from one added allowlist.

## Acceptance (before implementation)

- [ ] `.gitleaks.toml` gains ONE allowlist matching the identifier shape of the
      rules/compliance registry keys in the secret itself (lowercase dotted
      segments), so any commit touching those lines — in any file, on any
      branch — stops needing a new fingerprint.
- [ ] NO path condition in the allowlist: in gitleaks 8.28.0 an allowlist's
      paths and regexes are alternatives (either one alone suppresses a
      finding), so a path condition would blind the scanner to real credentials
      in the listed files. Verified by probe (a planted real-shaped key inside
      `src/domains/rules/registry.ts` was suppressed when paths were present,
      and flags again with the shape-only allowlist).
- [ ] The 30 converted per-commit fingerprint lines come out of
      `.gitleaksignore`; unrelated entries (fake test strings, the leads
      migration comment family, the self-referential entry) stay.
- [ ] Full-history scan with the repo config (all refs, the widest scope):
      zero findings with the fingerprints removed (baseline with the old
      config: 27 findings, all in this family, all from CMP-1's newer commits).
- [ ] Planted real-shaped keys (mixed case, hex, long tokens) still flag under
      the new config, including inside the registry files themselves, and the
      committed config file itself produces no findings.
- [ ] Reason for the allowlist change stated in the PR body (AGENTS.md section 1).

## Verification and handoff

Commands: the pinned gitleaks 8.28.0 binary against a probe repo (shape matrix)
and against the full clone (all refs); `node scripts/check-secrets.mjs` is a
separate repo-owned check and is unaffected (its rules are independent).
Update `docs/STATUS.md`. Merge is sequenced by the lane heartbeat so this PR
never knocks CMP-1's final CI run out of date; do not merge on the lane's own
timing.

## Evidence

Local, 2026-10-26 (Vivienne), pinned gitleaks 8.28.0. Probe repo: every planted
obligation-key line suppressed by the shape allowlist; five planted real-shaped
keys (mixed case, hex, long token) all still flag, two of them inside the rules
registry file itself; a paths condition was tested and rejected (it suppressed
a planted real-shaped key in the registry file — allowlist criteria are
alternatives in 8.28.0). Full clone, all refs (about 3,100 commits): baseline
with main's previous config found 27 leaks, all in this family (compliance
registry 15, compliance-filings test 12, from CMP-1's newer commits); with this
PR's config and all 48 family fingerprints removed: no leaks found — including
the CMP-1 squash commit's own attributions, which needed no refresh.
