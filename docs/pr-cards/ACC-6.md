# ACC-6 — Remember this device, and real new-device notices

Build spec: `docs/build-specs/engines/TRUSTED-DEVICES.md`. Design: `docs/designs/ACCOUNTS-AND-SIGN-IN.md` sections 6,
7 and 9 (`trustedDeviceDays (30)` was designed but never built; ACC-3 left it "for a later card"). **Approved by Chris 2026-10-25** ("Yes, add it", 30-day starting value). Depends on ACC-1…ACC-5 (merged #544–#548) and DEC-1a (for the Decisions question; if DEC-1a is
not merged, add a `DQ-` entry in `docs/OWNER-INPUTS.md` instead). Risk: **sign-in and second step** — read
`docs/AI-PR-READ-FIRST.md` and say in the PR how each auth item is honored.

## Why
Team members type a code at every sign-in, even on their own phone. The server would already accept a hand-made
"trust this device" request, ignoring the owner's choice. "New device" notices only notice a different kind of
browser, and customers never get one.

## One PR
The device cookie is what both the notice and the trust rules key on; splitting them would ship one half on the old
browser-type comparison.

## Acceptance
- [ ] Owner setting "Remember devices for {n} days" (starting 30, 0 = off), explained, restore recommended, and a
      Decisions & reviews question.
- [ ] Ticking "Remember this device" skips the code on that device until the set days run out — never longer.
- [ ] A hand-made `trustDevice: true` is ignored when the setting is 0 or for a customer (test).
- [ ] Password change, forgot-password reset, email change, two-step change, owner reset, removal, access change and
      sign-out-everywhere all make the next sign-in ask for a code (tests).
- [ ] New-device notice uses a device cookie; first sign-in records only; a second phone of the same kind is "new".
- [ ] Customers get the notice only through the customer-email switch; while it is off it is recorded as not sent.
- [ ] My account › Devices shows remembered devices and "Forget remembered devices".
- [ ] Device rows are left out of backups; privacy deletion removes them.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/marley/acc-6` (PR TBD): KnownDevice table + `BusinessSettings.trustedDeviceDays` (migration
`20261030010000_known_devices`); owner setting on Settings › Security with the 30-day starting value and a Decisions
& reviews question (`TRUSTED-DEVICE-DAYS`); the login two-step form offers "Remember this device for {n} days"
(hidden at 0); My account › Devices lists remembered devices with "Forget remembered devices"; a sign-in gate removes
a trust row whose device is no longer remembered; a hooks-only plugin registered after the two-factor plugin records
finished sign-ins (device cookie, new-device notice, remembered-until date) and clamps the library's trust row;
forgetting is wired into password change, forgot-password reset, email change, second-step change, turning two-step
off, owner reset, removal, access change and sign-out-everywhere; device rows are left out of backups and removed by
privacy deletion. Tests: `tests/trusted-devices.test.ts` (pure rules), `tests/known-devices.test.ts` (fakes),
`tests/trusted-devices-integration.test.ts` (throwaway Postgres, full sign-in flow), `e2e/my-account.spec.ts`
(remembered device shown and forgotten; checkbox hidden at 0). Unit tests pass locally; database and browser tests
run in CI only (no local Postgres here). PR #616 opened (head 8b0199f9); `ci` came back red — two My account browser
tests (a locator matching two elements; a settings save cancelled by an immediate reload), the customer
session-deactivation test (ACC-6 records customer sign-ins in the audit log, so the fixture deletes its audit rows
before deleting the user), the Bills sideways-scroll check at 360px in dark mode (a resize reporting the phone width
before the desktop sidebar padding was recalculated — fixed in the shared scan helper by BA-1, now reused here), and
one unit test timing out on a slow first import (import hoisted). Fixes in commit 6405616f; main (BA-1 #610) merged
in (a39ae329). Pushed as head 7df70d47, but no check run started on it in 45 minutes (snapshot pushes do not
reliably start CI). While waiting, the device integration test was run for the first time on the lane's own test
database (port 5435): it failed 8 of 10, a fifth failure the unit shard's bare "exit code 1" had hidden. Causes,
all in the test (the feature works): mixed-case fixture emails vs the app's lowercase storage, a stale trust cookie
replayed after rotation, the device cookie not presented to the gate, and the session token read from the signed
cookie instead of the session row. Fixed (test only); all 10 pass locally on port 5435. The hand-started run
(#2617) then came back red in 2 minutes with no test run: the seed fails on a missing `booksLastBroughtUpToDateAt`
column (the snapshot manifest had been diffed against current main, omitting the BA-1 migration and 38 other main
files from the remote branch created at 0516a31 — re-pushed with the manifest diffed against 0516a31, 76 files);
three type errors in the test from that fix round (typecheck not re-run after the edit — fixed, typecheck clean);
and 5 secret-scan leaks (four BA-1 false positives restored by the corrected push, plus the allowlist entry itself
flagged for its own SHA — allowlisted). `ci` green at the exact head and every review comment read are still to do.
Update 2026-10-26 (night): `main` moved (BILL-1 #612, preview-storage #609), merged into this branch as 164c968
(conflicts only in STATUS.md and DATABASE.md, both kept both entries); re-checked locally — typecheck clean, lint
0 errors, 41 unit tests pass. Push still blocked: the branch-creation approval timed out unanswered (01:39 MDT).
Update 2026-10-26 (morning): `main` moved again (FEE-1 #614), merged as 4636808, re-checked (typecheck clean,
lint 0 errors, 41 unit tests pass). Chris added the repo to the GitHub app installation; branch pushed and
PR #616 opened (head 8f703069); CI pending.

Two deviations from `docs/build-specs/engines/TRUSTED-DEVICES.md`, both from what the library actually does:
- The spec's rotation clamp in the app's global `after` hook cannot work: the app's hook runs BEFORE the two-factor
  plugin's sign-in hook, which rotates the trust row afterwards (a fresh row, full 90-day expiry). The follow-up
  lives instead in a hooks-only plugin registered after the two-factor plugin, whose `after` hook runs after the
  rotation. This also fixes a pre-existing issue: the old global hook recorded a new-device notice for a sign-in
  still waiting for its code (at that point the session still looks finished).
- The spec's Decisions subject has `recommended: 30`, but DEC-1a's registry test requires every subject's
  `recommended` to stay null until DEC-2 adds researched values with sources. The subject is registered with
  `recommended: null`; the 30-day starting value lives in the setting itself and on the Settings screen, and Chris
  approved 30 days on 2026-10-25.
