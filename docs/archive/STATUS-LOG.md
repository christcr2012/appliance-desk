> **RETIRED ENTRIES — reference only.** Rows and session-log lines trimmed from
> `docs/STATUS.md` once they are older than the last two batches. Newest first.

# STATUS log

_No entries yet (created 2026-10-02 with the consolidation)._

## Moved 2026-10-09

## Cleanup and autonomy — October 8

Two open implementation PRs were recovered: #315 and #317. #315’s last permission finding is fixed with persisted-state regression and exact-head review. #317 is synced once onto its final merged prerequisite; its populated upgrade/restore proof now covers configured settings and real RDF rate/record evidence.

Nine existing git worktrees were inventoried, plus the two isolated completion worktrees. Historical dirty work in four worktrees was preserved in local recovery commits under `refs/recovery/20261008/` and named stashes, then left clean. The rental-builder/job fixes shipped in `06d8342c`, customer workspace in `6c3a3a29`, audit in #127 and business templates in #287. Older revenue copies are superseded by receipt-ledger implementation `3514bdc0` and subsequent work. They are recovery history, not another implementation queue. Canonical checkout: `/workspace/scratch/c15372445dd5/appliance-desk`; lower agents start from fresh main here, not an old snapshot.

The instruction to end a turn solely because CI remained was removed. Use the existing two lanes, then a quiet bounded completion wait when finite CI is the only dependency. Provider/session limits still require a real resume mechanism; repo instructions do not restart an ended chat. Publish complete trees atomically, refresh the target base before preflight, and defer only accountable low-risk findings. Tests, exact-head checks, preview and required reviews remain mandatory.

For throughput assessment count **three implementation merges beginning with #317**, excluding #315/#316 and documentation-only #318. Record one brief result here after the next two implementation merges: elapsed time, substantive delivery/defects, red runs, superseded cancellations and base-sync work. No extra report or tracking lane.

## Cash-budget / startup banking design — October 8

Owner-requested documentation-only K-CASH design and dated primary-source research; proposed K-8 → nine K-CASH
groups → M, documentation reviewed and owner-approved for planning only. No runtime built or launch/T queue change. Confirmed-cash envelopes,
protected obligations, annual/recurring costs/targets, bank CSV matching/reconciliation, QBO import evidence and
contextual screens specified. K opening/export/forecast/posting-revision amendments explicit. IN-54/55 gate
account-specific activation, not synthetic engineering. No bank/provider/spending/live-money activation.

## Targeted publication checks — October 8

Owner requested immediate throughput improvements without recreating historical
failures. `npm run preflight` consolidates static checks and selected unit/database/
browser regressions; shared disposable fixtures now include ADMIN and dummy auth.
PLAYBOOK Step 4 replaces conflicting browser recipes. Full CI remains mandatory.
Launcher regression tests exercise failure propagation, selectors and incomplete
browser evidence; actual build/database/browser proof still comes from the named
local runs or exact-head CI, not the command plan. No launch gate or feature queue
changes. Assess the next three implementation merges for completed scope and red
CI rounds rather than raw PR counts; no extra report/workstream.

Local database testing uses Vercel Sandbox PostgreSQL. The shared launcher was
verified in the existing sandbox with six tax-overview integration tests passing
and zero skips; its disposable database was cleaned up. Missing PostgreSQL in a
scratch checkout is not evidence that the project sandbox is unavailable.
The final CI run exposed a purchasing browser-test race: its supplier-save URL
assertion also matched the `/new` form. Require the saved detail URL and named
supplier heading before navigating away; preserve all persistence/accessibility
assertions and normal timeouts.


## S-2 implementation evidence — October 9 UTC

Private OWNER-issued hashed/revocable AI check-up keys; safe typed GET issue API
and structured-only POST note API; server-side 60/hour/key limiter; manual
routine instructions without activation. New key model and nullable note
author reference are covered by disposable PostgreSQL schema/migration,
backup export/restore sanitization and 26 passing targeted DB/unit tests
including legacy owner notes, Today role behavior and navigation. Typecheck
and lint pass locally. New owner/admin keyboard/axe browser spec is registered
in browser-c; exact-head GitHub CI and preview are mandatory; local browser
binary unavailable. No payments, provider sends, external scheduled routine,
production database writes or spending enabled. Owner IN-45 remains deferred.


## COM-L1a pending merge — SMS safety

After Batch S-2 (PR #334) and before later COM features, COM-L1a adds
independent OFF-by-default SMS master activation, verified-STOP/dispatch
serialization, and one-shot UNKNOWN send semantics. Existing email retry
behavior remains unchanged; non-production/unmarked environments cannot
call Twilio even when credentials are accidentally present. Focused
real-Postgres messaging, SMS and deployment regressions (54 tests, initial
local validation) passed. Live SMS remains OFF; no provider configuration
or customer messaging was enabled. Exact-head CI and preview required.
