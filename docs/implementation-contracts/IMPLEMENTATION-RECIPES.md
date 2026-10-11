# Implementation recipes — read one matching section

Verified against main `9d582f5e316052ef3a28e22492723f49fab411be` (#396), 2026-10-11.
This is an execution aid, not a new design, queue or approval. AGENTS, approved design,
current card, OWNER-INPUTS and DRIFT-PROTOCOL retain their authority. Refresh named
symbols against the current base before using a recipe. **Existing** means present
at this baseline; **proposed** means a candidate to resolve in the current JIT card.
Do not author distant execution cards or implement every row below at once.

## Route to the smallest useful read

| Current work | Read here | Then read |
|---|---|---|
| Any JIT card | Card packet | Its design heading and named functions only |
| Form/settings/money | Settings and money | W-18 helpers; current action |
| State change/schema | Transaction and persistence | Current mutation and matching DB test |
| Stripe/email/SMS/recovery | Provider and receipt | AI-PR-READ-FIRST; current adapter |
| To do/portal/detail | Obligations and reads | Current DTO/query and destination page |
| Remaining W-22 | Worked example | [W-22 persistence recipe](W-22-PERSISTENCE-RECIPE.md) |
| Later cards | Remaining-work map | One mapped row, then write that card JIT |

## Card packet

Repeated discovery at #396: W-22's parent card lists payment/credit outcomes but
not persistence ownership; estimate exports wrap `index-base.ts`; manual payment
allocates invoices, not agreements; provider acceptance is different from settlement;
new models and shared-settings tests have registries. STATUS/roadmap also retained
pre-merge descriptions of COM-L15/W-1. These gaps make repeated research likely.

Add this small packet to the current card's existing build contract, not a separate
handoff. Include only changed interfaces; cite unchanged ones by path and symbol.

1. **Baseline/dependencies:** main SHA; prerequisite final PR/head; inherited review
   findings and dispositions; approved acceptance IDs; outstanding IN gates.
2. **Touch map:** each exact existing file + symbol + caller; proposed files visibly
   marked; one risk area, one migration owner, production-line/file estimate.
3. **Mapping:** submitted field → parser → domain input → persisted field → DTO/UI;
   trusted lookup source for IDs, prices, actor, customer, time and provider evidence.
4. **Sequence:** read/authorize/lock/recheck → calculate/write/audit/commit → external
   continuation → reconcile. Name locks in actual order and failure/replay results.
5. **Verification:** before/after database counts and sums; fixture inputs; exact
   expected outputs; forbidden mutations; named real DB race/rollback tests; commands.
6. **Handoff:** actual exports, constraints, activation defaults, evidence and what
   the successor can now rely on. Proposed interfaces are not completion evidence.

For each step, choose one existing proving test to adapt before inventing a fixture.
Stop researching when the packet is complete; edit the contract/tests. If a semantic
question remains, isolate it with DRIFT-PROTOCOL rather than guessing a schema.

## Settings and money

Existing reference: `src/app/desk/settings/signing-charge-actions.ts` →
`saveSigningChargeSettingsAction`; `src/app/desk/settings/signing-charge-form.tsx`;
`src/domains/settings/index.ts`; `src/lib/money-ui.ts`;
`src/components/ui/money.tsx`, `src/components/ui/info-tip.tsx`; `src/lib/money-words.ts`.

| Existing submitted value | Parse/check | Existing storage/consumer |
|---|---|---|
| `setupFeeDollars` (`45.00`) | `parseDollarInput(value, 1_000_000)` | `BusinessSettings.administrativeSetupFeeCents` = 4500 |
| `largeOrderMachineThreshold` (`5`) | integer 1–1000 | Same-named setting |
| `businessRequiresDownPayment` | checkbox `on`; restore sets true | Same-named boolean |
| `setupFeeTaxTreatment`, decision note | allowed string; confirmed treatment needs note ≥10 chars | Same-named fields; not proof CPA gate is cleared |
| `updatedAt` | valid ISO date, equals locked row timestamp | Optimistic edit check; never an actor/permission claim |
| `operation=restore` | server selects recommended defaults | $45, 5, true, UNDECIDED, null note |

Ordered recipe: require the allowed session role; parse; in transaction reauthorize
with `assertActiveTeamActor`; acquire the existing row lock; compare revision;
write setting + attributed audit; commit; revalidate. Preserve the reference's
actual lock sequence; adding other locks needs an explicit ordering in the card.
Money math belongs in a domain helper, not JSX. Add glossary entry once, reuse
Money/MoneyInput/InfoTip, and record the source/default on the screen.

Use `tests/signing-charge-settings-integration.test.ts` for the disposable singleton
fixture, restoration and audit cleanup. New tests that write settings or create
filing accounts go in `SHARED_SETTINGS_TESTS` in `vitest.config.mts`.
Prove invalid dollars and stale revisions leave storage/audit unchanged; revoked
actor cannot write; successful save adds exactly one audit. A disabled button is
not authorization. Run `tests/money-ui-w18.test.ts`, the affected DB test, and
`node scripts/check-w18-money.mjs`; add browser acceptance when a screen changes.

## Transaction and persistence

Existing references: `src/domains/agreements/index.ts` →
`lockRentalAgreementInTx`, `createDraftAgreementInTx`, `sendForSignature`;
`src/domains/billing/ledger.ts` → `lockCustomerLedger`, `createReceiptWithAllocations`;
`src/lib/team-actor.ts` → `assertActiveTeamActor`.

1. Inspect the whole current mutation and its callers (bounded sections); identify
   every write and external continuation. Use the transaction-aware core when a
   caller already owns a transaction; do not create independently committed children.
2. Write the actual existing lock order into the card; all competing paths must
   agree. Recheck actor, customer ownership and lifecycle under the relevant locks.
3. Put state, evidence and audit in the same transaction. Add DB uniqueness/check
   constraints only for reviewed invariants, with one additive migration.
4. Prove rollback by failing the final audit/write after earlier writes; before/after
   counts must match. Race two independent calls with `Promise.allSettled`; assert
   one legal result and durable counts, not which call wins. Replaying success must
   return/reuse the durable result and create no second money/evidence row.
5. Update `BACKUP_MODEL_POLICY` in `src/domains/backup/manifest.ts`, schema-health
   expectations and child-first fixture cleanup in the same commit (PLAYBOOK 4c).
   Update fake tx `$queryRaw`/delegates when a domain's DB calls change.

Existing proving tests: `tests/agreement-estimate-concurrency-integration.test.ts`,
`tests/manual-payment-concurrency-integration.test.ts`,
`tests/webhook-atomicity-integration.test.ts`, `tests/backup.test.ts`,
`tests/schema-health.test.ts`. Read the relevant fixture, not every suite.

## Provider and receipt

Existing: `src/domains/billing/provider-ops.ts` → `claimProviderOperation`,
`runProviderCall`, `completeProviderOperation`, `RetryLater`;
`src/domains/billing/checkout.ts` → `ensureStripeCustomer`,
`createCheckoutSessionForAgreement`, `startRecurringBillingForAgreement`;
`src/domains/billing/webhook-evidence.ts`, `webhooks.ts`, `webhooks-base.ts`;
`src/domains/billing/manual-payments.ts` → `recordManualPayment`.

Durable provider operations are a pattern, not blanket coverage: current signing
Checkout uses `checkout-agreement-${agreement.id}` directly. A revised payload must
have a reviewed immutable version/key; do not assume `ensureStripeCustomer` makes
all its callers recoverable. Provider network calls stay outside DB transactions.

| Evidence/input | Required treatment |
|---|---|
| Browser success redirect | Navigation only; cannot mark a payment settled |
| Verified provider event | Account, customer, agreement, amount/currency and payment state checked before ledger mutation |
| Delayed ACH | Pending/settled/failed distinguished using existing payment-status policy |
| Offline check/transfer | Owner action validates customer-scoped invoice; one Receipt with allocations |
| Timeout after provider acceptance | Reuse durable identity; reconcile result, never blind duplicate |
| Email returns `{sent:false}` | Failure/retry evidence; do not mark reminder sent |
| Replay/concurrent callback | One local receipt/effect; terminal state never regresses |

`recordManualPayment(customerId, actingUserId, input)` accepts positive integer
`amountCents`, `method`, optional `reference`/`notes`/`receivedOn`/`invoiceId`.
Without `invoiceId` it allocates across open invoices oldest-first. A signing payment
must have its proper payable invoice/allocations before this path can be reused;
passing an agreement ID is not an integration. Validate/re-authorize at the action
and inspect the ledger actor boundary before adding a caller.

Preserve `appliedBalanceCreditCents`/`creditLinesForAppliedBalance` in
`src/domains/billing/applied-credit-lines.ts`: they mirror provider-applied account
credit, not proof that a particular agreement's first bill was credited. The W-22
contract must establish per-agreement ownership before reusing account-wide credit.

Proving tests: `tests/billing-checkout-mode.test.ts`,
`tests/billing-checkout-idempotency.test.ts`,
`tests/remediation-r1-credit-handoff-reconciliation-integration.test.ts`,
`tests/remediation-r2-webhook-payment-status-integration.test.ts`.
Mock rejection and thrown errors separately; real Postgres proves rollback/race.
No live Stripe, emails, texts, refunds or paid provider setup as test evidence.

## Obligations and reads

Existing: `src/domains/exceptions/index.ts`, `src/app/desk/today/`,
`src/domains/portal/index.ts`, `src/domains/portal/workspace.ts`;
`src/lib/business-date.ts`; `e2e/route-inventory.ts`.

For an obligation, card maps source state → exact remaining cents → genuine Denver
business deadline → authorized destination → one action. Do not invent overdue
status when only urgency exists. Snoozes do not change financial/customer state.
Add the To do rule and destination together. Test the destination's authorization,
not merely the string. Use `tests/todo-w1*.test.ts` and
`tests/today-role-access.test.ts` as existing examples.

Reads filter roles/customer/assigned staff at query and DTO boundaries. Use the
page-specific portal query before broad `getPortalData` reuse. Fixture A/B customers,
foreign address/job/invoice, equal timestamps, >one page, and insert-between-pages;
assert no cross-customer data, deterministic ordering, bounded reads and navigation
for additional history. Mutation success must link the owner to the next real step.

## Remaining-work map — discovery anchors, not distant cards

Every path below exists at the baseline. New models/routes/functions are JIT proposals;
the named design/card determines acceptance and approvals. Search exported functions
inside the named domain, then trace its current caller/test. Do not copy historic line numbers.

| Work in approved order | Existing starting points | Required boundary / successor evidence |
|---|---|---|
| W-22 remainder | billing/signing-charges, checkout, webhooks-base; agreements/index; estimates/index-base (all under `src/domains/`) | Worked example; persistence is not collection or W-22 completion |
| W-23 | `prisma/schema.prisma` ServiceAddress; jobs/index; portal/index; messaging/portal-consent (under `src/domains/`) | Client is customer, tenant is contact; assigned STAFF only; IN-78 stays open |
| W-24 → W-25 | `src/app/sign/[id]/actions.ts`, page/sign-form; estimates/index-base; agreements/index; billing/checkout | Offered delivery options only; signed/payment/portal checkpoints; no card data; W-22/23 first |
| W-26 | `src/app/sign/[id]/`, `src/app/account/`, `src/lib/email.ts`, agreements/terms-snapshot | Proposed locale plumbing authored JIT; reviewed translations and signed language retained |
| W-14 → W-2 → W-15 | purchasing/index, purchasing/ledger, tax/acquisition, tax/purchase-tax-catch-up (under `src/domains/`) | One receipt/many serialized machines; cents allocation reconciles; per-machine evidence retained |
| W-3 → W-4 → W-5 → W-6 | tax/filing; jobs/index; billing/webhooks-base; exceptions/index; estimates/index-base | Real next steps; first delivery remains recurring-billing trigger; payment/reminder failure remains retryable |
| W-7 → W-8 | `src/app/desk/settings/`, `src/lib/desk-navigation.ts`, `e2e/route-inventory.ts` | Setup state is persisted truth; menu/count/route tests updated with screens |
| W-9 → W-10 | tax/filing-calendar, filing-reminders, filing-packet, filing-step-keys (under `src/domains/`) | Zero-dollar returns included; official proof/confirmation; never submission or stored tax credentials |
| W-19 → W-17 → W-20 | exceptions/index; agreements/progress; jobs/index; portal/workspace (under `src/domains/`) | Connected next steps/history and customer statuses; inherit W-16/21 credits |
| W-11 / W-12 / W-13 | tax/locations, tax/filing-packet; `src/lib/` provider boundary | Outside gates IN-61, IN-62/44, IN-64; verify selected provider/API before JIT; no paid provisioning |
| V → F-part-2 | `docs/DESIGN-SYSTEM.md`, `e2e/route-inventory.ts`, `e2e/shards.json` | Current PLAN acceptance; rendered widths/light/dark, real login, isolation, truthful launch evidence |
| K → K-CASH → M → O → COM-N | `docs/pr-cards/work-index.json`, current `docs/designs/` headings, billing/ledger, purchasing/ledger, messaging (domains) | After-launch order/gates in MASTER-ROADMAP; no speculative execution cards; propose interfaces only after predecessors ship |
| BP and deferred work | `docs/MASTER-ROADMAP.md` approved-sequence table; work-index acceptance IDs | Proposed/deferred scope is not runtime approval; preserve owner/data/provider gates |

## Focused validation and completion

Existing commands (repo root; bounded shell/output, PLAYBOOK remains authority):

```bash
npm run setup
python3 docs/pr-cards/validate-index.py
npm run check:quick
# Preview the selection; this is NOT evidence tests passed:
npm run preflight -- --plan --unit tests/signing-charge-plan-w22.test.ts
# Real DB tests only in the existing Vercel Sandbox throwaway Postgres:
timeout 600 npm run preflight -- --unit tests/signing-charge-plan-w22.test.ts --db tests/signing-charge-settings-integration.test.ts
```

Repeat `--unit`/`--db`/`--browser` for each selected existing or newly created test;
never run a DB-gated test as a plain unit command and call a skipped suite evidence.
A changed screen selects its actual browser spec. PLAYBOOK 4c registry checks and
preflight's related-source tests are additions, not substitutes for exact-head CI.
Heavy full suites belong in free Actions; no unnecessary sandbox/browser rebuild.

Documentation-only PR: index validator, `git diff --check`, `npm run check:quick`,
path/link/manual contract review, exact-head `ci`; heavy app tests/previews may be
skipped by existing CI classification. No test/CI policy change here.

Completion packet in PR: acceptance→test/evidence, before/after durable counts/sums,
review dispositions, base/head, CI run and red/cancelled counts; outstanding IN gates;
changed interfaces/defaults/uniques/lock order and successor inheritance. Checklist B
updates STATUS/card and living docs inside the PR. Never tick acceptance for a helper
without its persisted caller behavior, or turn a recommended answer into approval.

The attached Package 1 audit was inspected as historical evidence (2026-10-01,
`851f319...`), not imported as a new queue. Its atomicity/idempotency, `{sent:false}`,
rollback and customer-isolation cases inform these recipes; each finding still needs
current-code verification and its assigned batch. Do not revive its older PR grouping.
