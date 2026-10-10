# COM-L13A — Owner telecom setup and private statement evidence

Status: MERGED after exact-head CI and review (PR assigned at merge). Baseline main de77e21 (COM-L12 #378 merged). Approved source BATCH-COM §2.4, §6.1–6.3, §7–9; work-index COM-L13A.

Drift: L2 accounts/numbers and versioned BusinessSettings communicationsPolicy exist. L6 templates already have versioned storage; do not build duplicate templates. L10 TelecomStatement supports private evidence, hash, DRAFT/VERIFIED, revision and verifier. L11 only observes provider use; L12 computes compared costs, no alerts. No direct provider writes, number purchase, real SMS, recording or K Expense.

Acceptance: An accessible owner telecom setup page under existing Settings shows recorded account/number, actual read-only capability/freshness, owner policy and SMS template status separately from readiness and legally approved live activation. Owner can store default-OFF budget alert proposals with versioned conflicts, dollars inputs, restore recommendation, and no automatic communication activation. Private PDF statement upload limited to OWNER, size/content verified, stored in existing private Blob, account-scoped metadata/hash and audit, no public URL or provider upload. Verification step requires explicit owner decision and independently recorded evidence; no automatic statement VERIFIED/paid, no bank/Stripe/journal entry. ADMIN reads bounded metadata, STAFF/CUSTOMER denied. No schema migration unless scope mapping requires it. Unit/isolated DB tests, browser navigation, exact-head CI and manual self diff review mandatory. Automated review unavailable — waived.

L13B integrates evidence-labelled reports, Today and health. IN-51/52/53 remain gates for any live action.

## Acceptance evidence and continuation
- Private Settings page navigated from Notification settings, shows recorded account/number readiness, existing SMS template approvals, master sending switch and distinct budget suggestions; no real Twilio action.
- Versioned owner budget proposals start OFF; when no communications policy exists, initialize only with a genuine recorded primary number and disabled SMS/voice/inbound features. Update refuses to silently modify active send/voice policy. IN-53 is still a live activation gate.
- Owner-only private PDF upload saves within approved private Blob with 4 MB cap, PDF header/footer, private storage key and SHA-256 evidence. Verifying requires owner confirmation and read-back SHA-256 of stored bytes. ADMIN can download finance evidence; STAFF/CUSTOMER cannot. No paid state or Expense created; revisions append.
- Local focused real Postgres tests demonstrate DRAFT, tamper/permission denial, explicit VERIFIED, revision and no payment; pure policy tests cover OFF defaults. Browser CI covers nav/mobile/axe. Browser local test was blocked by symlink outside Turbopack project root, not a passed browser test; mandatory GitHub CI evidence before merge.
- Automated review unavailable — waived; self-inspect money, account scope, role gates and provider side effects. No L13B report/Today or COM-N posting is claimed.
