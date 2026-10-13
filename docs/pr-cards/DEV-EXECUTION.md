# DEV-EXECUTION — owner-authorized implementation efficiency

Owner request 2026-10-12: implement the workflow diagnosis and practical tooling,
in one larger cohesive PR, so lighter selected models can finish the remaining project.
Baseline: merged #423 (`600f93ed`); product W-22 remains PARTIAL. This maintenance
capability does not add an acceptance unit or authorize product/financial behavior.

## Outcome and implementation

- Dependency-free `work` entrypoint: current packet, bounded numbered code reads, later-unit route, reference and
  selector validation, drift, setup diagnosis, plan/probe/verify, timing summary and
  compact continuation draft. Packets cannot contain arbitrary shell commands.
- Safe per-worktree dependency installer supplies synthetic localhost generation
  config, removes inherited provider/deployment identity and includes dev tools; no
  migrations/seed/real DB operation. Missing DIRECT_URL was reproduced in this session.
- Fail-closed planned regression verification, repository/symlink path protection,
  parent scope and existing symbol/heading checks; the existing always-on secret
  scan entrypoint enforces packet health in CI, including docs-only changes. No
  workflow-file modification or expanded token permission is needed.
- Actual-file pass fingerprints remain identical across stage/commit/deletion commits,
  but invalidate on content/path/mode/symlink changes or unresolved merge state.
- Secret scanning covers the same tracked/non-ignored-new files before and after
  staging; symlinks are scanned by identity, not external target contents.
- Bounded elapsed/failed/passed/cached local check records; no provider/secret output,
  no assertion those timings prove CI/customer acceptance.
- Reconcile old size/stop/preview/release/bookkeeping contradictions; preserve all
  existing substantive safety, owner activation, migration, test and exact-head gates.
- Short W-22 parent + preserved historical log, concrete D12 invoice presentation/proof
  contract from #423, current roadmap/status and reusable packet authoring guidance.

## Validation and evidence

Run `npm run check:preflight`, `npm run check:work`,
`python3 docs/pr-cards/validate-index.py`, `git diff --check` and the existing quick
pre-push gate. Node regression fixtures use throwaway temporary Git repositories;
no PostgreSQL/product code changes require a new DB test for this maintenance PR.
Existing full exact-head Actions CI, release-policy and performance checks still apply.
Automated review unavailable requires the existing explicit manual disposition,
never an invented review. Record measured node tests/cache behavior and PR/main
checks in the permanent handoff. D12 proposed tests deliberately do not exist yet;
verification must refuse them until the next implementer supplies real tests.

## Status

MERGED #424 at main `059fa296c37f160163e6428c3ff6770f7ef3e790` after exact-head CI/release-policy and documented manual review. Confirm current main CI separately. No live deployment, payment, refund,
communications, resource increase or customer acceptance claimed. No downstream
product contract changed. Next: W-22D12, not another architecture/planning session.
