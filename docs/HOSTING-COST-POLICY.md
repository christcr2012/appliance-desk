# Hosting and CI cost controls — 2026-10-12

**Scope:** Appliance Desk. Owner-authorized cost profile; not authority to
activate production billing, change taxes, spend, or deploy manually.

## Development and release

- Submit implementation PRs to `main` and require the repository's actual
  GitHub Actions CI/review gates at the **exact PR head**.
- Do **not** wait for automatic Vercel previews or run manual Vercel deployments
  after a PR/batch. Automatic previews are disabled by owner instruction.
- Only the checked, Denver-day scheduled workflow advances a green `main`
  commit to `live` at most once per day. Never directly push, force, or merge
  development branches into `live`.
- The release workflow, its configured required checks, branch divergence
  protections, and emergency exception procedure are authoritative in
  [`.github/RELEASE-POLICY.md`](../.github/RELEASE-POLICY.md) and
  [`.github/release/policy.json`](../.github/release/policy.json).
- Vercel production tracks `live` only. Preserve Basic build machines,
  queued concurrency and live-only Git build filters configured by the owner.
  GitHub Actions and disposable local PostgreSQL tests remain the source of
  validation without paid preview deployments.

## Database and spend

- The verified low-usage Neon profile is 0.25 CU minimum/maximum with
  300-second autosuspend and no artificial keepalive polling. See the
  authoritative [`.github/NEON-COST-POLICY.md`](../.github/NEON-COST-POLICY.md)
  for measurement-based scaling, pooled/direct connection guidance and owner
  approval requirements.
- Do not consolidate or resize databases, increase paid resources, change
  production access, alter billing or Stripe LIVE, or override tax/legal
  decisions without the applicable explicit owner approvals.
- Cold-start latency may occur after Neon autosuspend; do not treat a
  recoverable first connection delay as grounds for spend changes.
- Preserve any existing cost budgets, secret protections, data retention and
  production activation gates. For W-22 specifically, CPA IN-79 is **OPEN**.

## Agent operating checklist

At session start inspect current `main`, PRs, CI, reviews and any active
worktrees, then follow the normal repository card/protocol. Incorporate policy
changes into the **next substantive feature PR**, not a standalone docs PR.
When another agent changes hosting settings, fetch and merge latest main while
preserving newer work. Update `docs/STATUS.md` and required card/database docs
in the same PR. Never count a change until exact-head required checks and
reviews have passed and GitHub confirms the merge.

This is a navigation/coordination summary. The merged repository-specific
release and Neon policies above win over conflicting historical instructions.
