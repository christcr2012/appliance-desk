# Design — Batch G: Audit fixes and owner-account security

Status: **PROPOSED — waiting for Chris's approval.** Do not implement until this line says APPROVED.
Written 2026-10-06 by Claude Opus 5.5 against `main` 23eff64, from the findings in
`docs/reviews/2026-10-06-owner-audit-and-recommendations.md` (F1, F2, F4, F5 and the small items). F3 (one tax rate for
every address) is Batch T. Scope and acceptance: `docs/PLAN.md` → Batch G.

**Who this is written for.** An implementing model following it literally. Small batch: **two PRs**. It can run as soon
as Batch E2 has merged (it touches the desk layout and login, which E2 restyles).

---

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| G-A1 | `npm audit --omit=dev` reports `sharp` (<0.35.5) and `source-map-js` (1.0.0–1.2.1) as high, fixable without a major version change. | run it; if the fix needs `--force` or a major bump of `next`, stop (S-G1) |
| G-A2 | `closeAgreementInTx` (`src/domains/agreements/index.ts`) sets `endDate` only for `ENDED`; `renewal-start.ts` (~line 227) sets `status: "ENDED"` directly. No other code writes agreement status ENDED/CANCELLED. | `grep -rn "status: \"ENDED\"\|status: \"CANCELLED\"" src/domains/agreements src/domains/billing` |
| G-A3 | `getEarningsReport` (`src/domains/reports/index.ts`) has no status filter; `computeEstimatedEarningsCents` caps at `endDate` or `asOf`. | read both |
| G-A4 | Better Auth is `^1.7.x` and ships the `twoFactor` server plugin and `twoFactorClient` client plugin (TOTP + backup codes). Read the plugin's docs inside `node_modules/better-auth` (or its `dist` README/types) before writing code; the Prisma models it needs must be written by hand to match its schema. | inspect the installed package |
| G-A5 | `src/app/desk/layout.tsx` is where every desk page's session is checked. | read it |
| G-A6 | `PREVIEW_PRIVATE_STORE_ID` in `src/domains/preview-storage/index.ts` is listed in the reviewed allowlist inside `scripts/check-secrets.mjs` with a reason. | grep |

---

## 1. Decisions

- **D-G1 Dependency fix** — `npm audit fix` (no `--force`), commit the lockfile only, run typecheck/lint/unit tests;
  CI's build and browser shards prove the image pipeline still works.
- **D-G2 Agreements remember when they closed** — new nullable column `RentalAgreement.closedAt`, set to the transaction
  time whenever an agreement becomes ENDED or CANCELLED (both code paths in G-A2). The estimated-earnings calculation
  stops at the earliest of `endDate`, `closedAt` and `asOf`. Migration backfill: `closedAt = COALESCE("endDate",
  "updatedAt")` for rows already ENDED or CANCELLED (production has none; the drill proves old rows). `endDate`
  semantics do not change (other code relies on them).
- **D-G3 Two-step login for the people who can move money** — Better Auth `twoFactor` plugin (authenticator-app codes
  plus 10 single-use backup codes; no SMS codes because SMS sending is off). New owner setting
  `BusinessSettings.twoFactorRequiredRoles Json @default("[\"OWNER\",\"ADMIN\"]")` (STAFF can be added; CUSTOMER never),
  explained on Settings → Security: "Anyone in these roles must enter a 6-digit code from an authenticator app after
  their password. Recommended: Owner and Admin, because they can refund money and see every customer." with "Restore
  recommended". Enforcement in `src/app/desk/layout.tsx` **and** in `requireRole` for OWNER/ADMIN: a signed-in user
  whose role is required and who has not enrolled is sent to `/desk/security/setup` (the only desk route reachable
  until enrolment); server actions for those roles throw the same way, so enforcement is not just a redirect.
  Recovery when a phone is lost: a backup code; if none, the runbook `docs/runbooks/two-factor-recovery.md` (Chris runs
  `scripts/reset-two-factor.ts --email <x> --confirm` from a trusted machine; the script refuses without `--confirm`
  and writes an audit row). Passkeys are listed in ROADMAP, not built.
- **D-G4 Session control** — Settings → Security lists the signed-in user's own sessions (device text, last active,
  created) with "Sign out everywhere else". The owner's Staff screen gets "Sign this person out everywhere" (deletes
  their `Session` rows in a domain function guarded by `requireRole("OWNER")`, audit row). Deactivating staff already
  blocks access; this adds the immediate sign-out.
- **D-G6 Dark-mode status colours (accessibility, found 2026-10-06)** — `.dark` in `src/app/globals.css` overrides
  neither `--color-success` (#1e6b3e) nor `--color-danger` (#a3271f), and `text-success`/`text-danger` are used in about 54
  places. On the dark surface (#152e22) they measure 2.2:1 and 2.0:1 (WCAG AA needs 4.5:1). Add
  `--color-success: #7fd39a; --color-danger: #ff9b8f;` to the `.dark` block (8.1:1 and 7.2:1) and the contrast unit test
  `tests/theme-contrast.test.ts` described in `docs/designs/BATCH-V.md` V-2a. Goes in PR G-1.
- **D-G5 STATUS** — refresh `docs/STATUS.md` to show Batch E2's merged parts (#250–#260) and add rows for G, T, K, O.

## 2. Schema (additive) — migration `<timestamp>_batch_g_security`

`RentalAgreement.closedAt DateTime?`; `BusinessSettings.twoFactorRequiredRoles Json @default("[\"OWNER\",\"ADMIN\"]")`;
the plugin's fields: `User.twoFactorEnabled Boolean @default(false)` and model
`TwoFactor { id String @id; secret String; backupCodes String; userId String; user User @relation(...) }` (names and
columns must match what the installed plugin expects — G-A4). The plugin stores the secret encrypted with
`BETTER_AUTH_SECRET`; never log or display it after enrolment.

## 3. Work units

**PR G-1:** WU-G1 dependencies; WU-G2 `closedAt` + earnings fix; WU-G6 dark-mode status colours; WU-G5 STATUS.
**PR G-2:** WU-G3 two-step login; WU-G4 sessions.

Tests:
- WU-G2 ★ `tests/agreements-closed-at-integration.test.ts` (both close paths set it; cancelled ACTIVE month-to-month stops
  earning on the cancel date; ended unchanged), update `tests/reports-earnings*.test.ts` for the new cap.
- WU-G3 `tests/two-factor-policy.test.ts` (pure: who must enrol from the setting; CUSTOMER can never be required),
  ★ `tests/two-factor-enforcement-integration.test.ts` (unenrolled ADMIN's server action is refused; enrolled passes;
  STAFF unaffected by default), browser `e2e/two-factor.spec.ts` (enrol with a generated TOTP secret in the test,
  sign in again with a code, use a backup code once, second use refused; assign a shard). The CI login helper
  `scripts/create-ci-login.ts` must create enrolled owner/admin logins (or the saved sessions in `e2e/global-setup.ts`
  must complete the second step) so existing specs keep working — this is part of WU-G3, not optional.
- WU-G4 ★ `tests/session-control-integration.test.ts` (sign out others keeps the current session; owner signs out a
  staff member; ADMIN cannot).

## 4. Stop-and-ask

- **S-G1** The audit fix needs a major upgrade (for example of `next`).
- **S-G2** The installed Better Auth version lacks the plugin or its API differs from D-G3.
- **S-G3** Enforcing the second step would break the CI login approach in a way WU-G3 cannot fix inside `scripts/` and
  `e2e/global-setup.ts`.

## 5. Go-live lines

- "Security: you (Owner) have turned on two-step login and stored your backup codes somewhere safe, away from your phone."
- "Security: every Admin has enrolled in two-step login."
