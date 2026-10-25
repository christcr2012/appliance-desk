# ACC-6 — Remember this device, and real new-device notices

Build spec: `docs/build-specs/engines/TRUSTED-DEVICES.md`. Design: `docs/designs/ACCOUNTS-AND-SIGN-IN.md` sections 6,
7 and 9 (`trustedDeviceDays (30)` was designed but never built; ACC-3 left it "for a later card"). Part of the
approved ACC batch. Depends on ACC-1…ACC-5 (merged #544–#548) and DEC-1a (for the Decisions question; if DEC-1a is
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
Not started.
