# MASTER ROADMAP — everything left, in order

**Read this after `AGENTS.md` and `docs/STATUS.md`.** It is the single ordered list of remaining work from today to
launch and beyond, written so an implementing model (for example Sol 5.6) can pick the next step without re-planning.
It does not replace the batch acceptance lists (`docs/PLAN.md`) or the designs (`docs/designs/BATCH-<X>.md`): it points
to them and says **what comes next, what must be true before it starts, and what only Chris can do.**

Last reconciled with the code: 2026-10-06 at `main` 0a52c98 (Batch E2 complete; docs audited against code the same day,
see "Documentation audit" at the end). Keep this file current: when a step finishes, tick it, add the PR numbers, and
move the "▶ Next" marker.

---

## 1. Where things stand (plain English)

Everything a rental business needs day to day is built and tested: leads, estimates, agreements and e-signature,
delivery/pickup/repair visits, inventory and parts, billing through Stripe (test mode), late fees, renewals,
month-to-month rentals, notices, the website editor, privacy requests, messaging records, reports and the redesign
(E2). Live payments, customer email and SMS are switched **off** on purpose until Chris approves them.

What is missing before real customers: **correct Colorado sales tax** (Batch T), a few **audit fixes and two-step login**
(Batch G), a **public website that looks clearly premium** (Batch V — Chris rejected E2's public-site look), and the
**final launch proof** (Batch F). After launch: **books and accounting exports** (K), **more owner controls** (O), and
**customer self-service and growth** ideas (P).

## 2. The order

Legend: ✅ done · ▶ next · ⏳ waiting on Chris · ○ not started. "Design" says whether the build instructions are approved.

| # | Step | Design | Can start when | Chris must do first | PRs (approx.) |
|---|---|---|---|---|---|
| 1 | ✅ Batches A, B, B2, C, R, D, E, E2 | approved, built | — | — | merged |
| 2 | ▶ **F-part-1** — backups that restore, media second copy, capacity numbers, runbooks (Batch F WU-F1, F2, F4, F5) | ✅ approved (`BATCH-F.md`) | now | nothing | 2–3 |
| 3 | ○ **G** — audit fixes, dark-mode contrast fix, two-step login, session control | ✅ approved (`BATCH-G.md`) | F-part-1 merged | nothing | 2 |
| 4 | ○ **T** — Colorado sales and use tax | ✅ approved (`BATCH-T.md`) | G merged | nothing to start (register on SUTS for the free GIS key when ready — manual entry works without it) | 4 |
| 5 | ○ **V** — "Evergreen Signature" public-site redesign + desk/portal polish | ✅ approved (`BATCH-V.md`, concept artifact) | T merged | accept the before/after screenshots before each public-site PR merges | 3–4 |
| 6 | ○ **F-part-2** — end-to-end scenarios, owner guide with screenshots, review-thread discharge, launch ledger, rollback plan (WU-F3, F6–F9) | ✅ approved | steps 3–5 merged (so the proof covers the final product) | nothing | 3 |
| 7 | ⏳ **Launch** — Chris's go-live checklist | `docs/GO-LIVE-CHECKLIST.md` | step 6 done | CPA answers IN-17, IN-33…IN-38 entered; attorney wording; live Stripe/email decisions; launch authorization | — |
| 8 | ○ **K** — books: journal, expenses, Stripe fees, P&L, QuickBooks/Xero/other exports | ✅ approved (`BATCH-K.md`) | launch (or earlier if Chris asks; needs T merged) | nothing to start; IN-39 later | 5 |
| 9 | ○ **O** — owner controls: settings undo, per-person permissions, approvals, dated prices, goals, switches page | ✅ approved (`BATCH-O.md`) | K merged | nothing | 4–5 |
| 10 | ○ **P** — customer self-service and growth (section 5) | **no design yet** — a stronger model writes it when Chris picks items | after O, or earlier for a single picked item | pick items | — |
| 11 | ○ Conditional/deferred: Google Workspace integration (O32), CSV import (O29), direct QuickBooks sync (`BATCH-K.md` §9) | deferred | prerequisites in their docs | provide accounts/data | — |

**Why F is split (approved by Chris 2026-10-06, IN-41):** F proves the finished product. If F runs completely now, the
tax, security and redesign work that follows would make its scenarios and screenshots stale. Its infrastructure parts
(backup/restore, media copy, capacity, runbooks) do not depend on those batches, so they run now; its product-wide
proof runs last. If Chris prefers, F can run whole now and the scenario/screenshot work units are re-run after V.

**Approval record:** Chris approved designs G, T, V, K, O and the F split on 2026-10-06 ("I love all of this! Update the repo!"). Work them strictly in the order above, one batch at a time. A design marked PROPOSED or DRAFT must never be started.

## 3. How an implementing model runs a step

Paste into a new session (replace `<X>`):

> Read AGENTS.md, docs/START-HERE.md, docs/STATUS.md, docs/MASTER-ROADMAP.md, then docs/designs/BATCH-<X>.md in full.
> Do the design drift check (section 0 of the design and docs/designs/README.md) and record it in the first PR. Build
> the work units in order as a stack of PRs, one PR per group the design names, following docs/PLAYBOOK.md. Do not
> re-decide anything in the design's Decisions section, do not add anything it does not name, and stop and ask Chris at
> every stop-and-ask point. Never enter a tax rate, a tax answer, a price or a legal promise yourself. After each PR:
> exact-head CI green, review threads read and dispositioned, then merge per AGENTS.md. Use the PR list in
> docs/MASTER-ROADMAP.md section 7, keep each PR within docs/PLAYBOOK.md Step 3a's budget, follow Step 8 for CI
> (at most 3 red CI runs per PR, then stop and report), and stop after two merged PRs per session with a STATUS handoff. At the end update
> docs/STATUS.md and tick the step in docs/MASTER-ROADMAP.md, and report to Chris in plain English.

For F-part-1 use the same prompt with `BATCH-F.md` and add: "Build only WU-F1, WU-F2, WU-F4 and WU-F5 now."

## 4. Chris's action queue (only Chris can do these; nothing here is urgent unless a step is waiting)

| ID | What | Blocks |
|---|---|---|
| IN-33 … IN-38, IN-17 | CPA and attorney answers for sales tax (questions in the overview) | **billing real customers** (not building) |
| — | Register on Colorado SUTS; put the GIS key in Vercel yourself | automatic address lookup (manual works without it) |
| IN-39 | CPA: tax on written-off bills, depreciation and 1099 starting values | nothing (conservative defaults) |
| IN-21, IN-31 | Month-to-month notice wording; live customer email approval | turning on customer email |
| Go-live list | Everything in `docs/GO-LIVE-CHECKLIST.md` | launch day |

## 5. Ideas beyond the current designs (Batch P candidates — Chris picks, then a design is written)

These come from Chris's original goals (the September "complete operating platform" brief and the growth brainstorm in
`docs/reviews/`) and are **not built**. Each needs an owner decision first because today's rule is "Chris approves
everything at launch" (`docs/BUSINESS-RULES.md`).

**Customer self-service**
1. **Online "Rent now"**: address check → choose appliances and term → see the exact monthly price with tax for that
   address (after T) → create an account → sign → save a card → pick a delivery window. Chris still confirms
   hookups before the visit is booked (an approval step, not a phone call).
2. **Delivery-window picker** from the dispatch calendar's free slots, with owner-set windows per day.
3. **Moving? Transfer my rental** request: new address check, pickup + delivery pair created for Chris to approve.
4. **Card-expiring reminders** a month before the saved card expires (needs live email approval).
5. **Text-message visit updates** ("on our way") once SMS is approved.

**Operations**
6. **Route order for the day** (group by area first; map-based ordering later, a paid provider needs approval).
7. **Parts reorder alerts** from the existing reorder thresholds.
8. **Offline-tolerant driver view** for spotty connections (B16 follow-up).
9. **Mileage log** for vehicle costs (feeds Batch K).

**Growth**
10. **Review requests** after a successful delivery (needs live email/SMS).
11. **Referral program dashboard** (referrals already exist in the data).
12. **Demand forecast and "buy more washers" signal** (B26 follow-up, from fleet utilization).
13. **Annual price-review prompts** for long rentals (never automatic).

**Platform**
14. **Passkey login** after two-step login (G).
15. **Direct QuickBooks Online sync** after the K file exports have been used for a quarter.
16. **Error and uptime alerts to Chris's phone** (Sentry monitoring exists; confirm which alerts are configured and where they go).

## 6. Documentation audit (2026-10-06)

Checked every file path cited in the working docs against the repository, every database table against
`docs/DATABASE.md`, every scheduled job against `docs/ARCHITECTURE.md`, every environment variable read by the code,
and every desk screen against `docs/OWNER-GUIDE.md`. Fixed the same day:

- `docs/DESIGN-SYSTEM.md` named a removed `desk-sidebar.tsx` → now the E2 app shell and bottom tab bar.
- `docs/PRODUCT-SPEC.md` and `docs/ROADMAP.md` named a removed accessibility spec → now the generated route specs.
- `docs/ARCHITECTURE.md` was missing the `billing-reconcile` nightly job (four recovery passes), the private
  photo/preview store variables and the build-only Sentry variables → added, plus a schedule table matching `vercel.json`.
- `docs/DATABASE.md` was missing `CustomerContact` → added.
- `docs/OWNER-GUIDE.md` was missing Notices, Automations, Privacy requests and the Launch list in its desk tour, and
  described Revenue numbers as "not estimates" (they are estimates from agreed prices) → corrected.
- `docs/BUSINESS-RULES.md` presented one sales-tax rate as sufficient → known gap noted with a pointer to Batch T.

Found in code, not docs (scheduled into batches): dark-mode success/error text contrast 2.0–2.7:1 (Batch G, D-G6);
hard-coded, partly unverified marketing promises on the home page (Batch V, V-3); tax-confirmed tick box gates nothing
(Batch T, D-T7); cancelled rentals inflate estimated earnings (Batch G, D-G2).

## 7. PR plan for every remaining batch (Chris, 2026-10-06)

This table **overrides the "PR …" grouping lines inside the designs**; the work units, their order and their tests are
unchanged. Each row is one PR, sized to the budget in `docs/PLAYBOOK.md` Step 3a (about 500 lines of production code,
one risk area, at most one migration, at most one red CI run expected). Stack them in order; merge bottom-up. A row
that still turns out over budget is split inside its work unit as Step 3a describes (G-2 and T-4 are the likely ones). "CI watch" names the
tests most likely to break, so the agent updates them in the same PR instead of discovering them in CI.

### F-part-1 (now)
| PR | Work units | Risk area | CI watch |
|---|---|---|---|
| F1-a | WU-F1 consistent backup export, restore script, restore drill | data/backup | backup manifest and table-order tests; schema-health |
| F1-b | WU-F2 media inventory and second copy | storage | private-media and privacy-deletion tests (a deleted file must never come back) |
| F1-c | WU-F4 capacity fixtures and regression guard + WU-F5 runbooks | performance/docs | `tests/perf/*`; keep fixture creation fast (unit shard under ~2 min) |

### G — audit fixes and owner security
| PR | Work units | Risk area | CI watch |
|---|---|---|---|
| G-1 | WU-G1 dependency fix, WU-G6 dark-mode colours + `tests/theme-contrast.test.ts`, WU-G2 `closedAt` (the batch's one migration), WU-G5 STATUS | schema (small) | earnings tests (`tests/reports-earnings.test.ts`, `tests/earnings-not-cash.test.ts`); dark-mode axe spec; build (sharp) |
| G-2 | WU-G3 two-step login **with** CI login and saved-session updates | auth | **every browser spec** (saved sessions), `staff-security`, `session-deactivation`; route inventory for `/desk/security/setup` |
| G-3 | WU-G4 session control | auth | session tests; staff screen spec |

### T — Colorado sales and use tax
| PR | Work units | Risk area | CI watch |
|---|---|---|---|
| — | WU-T0 is Chris's SUTS registration plus the GIS runbook; the runbook (docs only) rides with T-2. WU-TA0 (Amendment A): once registered, record the SUTS return screens in `docs/runbooks/suts-filing.md` (IN-43) | — | — |
| T-1 | WU-T1 migration, seeds, backup/schema-health + WU-T2 pure engine, categories, allocator | schema + pure logic | migration check, populated-upgrade drill, backup coverage test |
| T-2 | WU-T3 GIS adapter (fake source; real client only if the runbook exists) + address locating hooks | provider (read-only) | customer/address and rental-builder tests (locating runs after address saves) |
| T-3 | WU-T4 readiness gate + Stripe tax rates **+ `seedTaxReadyContext()` helper and CI seed update** | money | **every test that signs an agreement or sets up billing**, checkout/webhook integration tests, rental-builder and signing browser specs |
| T-4 | WU-T5 local invoices and the Stripe mirror use the engine; old single-rate assertions updated | money | pickup/late-return/early-return/waiver tests, webhook mirror tests, statements |
| T-5 | WU-T6 exemptions + rate-change and re-check automations | money/automation | automation run tests, cron route auth tests |
| T-5b | Amendment C WU-TC1: automatic official rate updates with guardrails and undo, look-ahead to Jan 1 / Jul 1, official page watch (`BATCH-T.md` section 13) | automation/provider (read-only) | automation run tests, cron route auth tests, rate-change (D-T9) tests |
| T-6a | WU-T7 filing accounts + Amendment A WU-TA1: filing calendar, due dates and holidays, Today tasks (11.11 exception rules)/email prompts, owner alerts, calendar file (`BATCH-T.md` section 11) | schema + automation | migration check, automation run tests, cron route auth tests, messaging delivery tests |
| T-6b | WU-T7 worksheet → Amendment A WU-TA2 SUTS entry packet, use tax (+ appliance form field, purchase-order hook), mark filed, amended returns (11.12) | money | purchasing/receipt tests, appliance form tests |
| T-6d | Amendment D WU-TD1: appliance intake "Sales tax when you bought it", per-appliance rental exemption, automatic annual/monthly use-tax frequency, DR 0252 filled PDF or worksheet (`BATCH-T.md` section 15) | money + screens | inventory/intake tests, engine tests, readiness tests, purchase-order receiving tests |
| T-6c | Amendment B WU-TB1: Colorado retail delivery fee — automatic status, delivery-completion records, customer line or pay-myself, RDF return packet (`BATCH-T.md` section 12) | money | job completion tests, invoice/statement tests, Stripe invoice-item provider-operation tests, readiness tests |
| T-7 | WU-T8 screens organized by `BATCH-T.md` section 14 (screen map: one Sales tax nav entry, six tabs, return page, Today routing, setup checklist) + WU-T9 docs | screens | route inventory (every new page), axe light/dark, `e2e/sales-tax.spec.ts` shard assignment |

### S — System issues inbox and the AI check-up (`docs/designs/BATCH-S.md`, approved 2026-10-07)
| PR | Work units | Risk area | CI watch |
|---|---|---|---|
| S-1 | WU-S1 `SystemIssue` table, redaction, writers (automations, stuck provider operations, tax lookup/page/rate sources), sweep rule, System health page, Today "System" group | schema + automation | automation run tests, health page browser spec, backup coverage test |
| S-2 | WU-S2 AI check-up keys, `/api/ops/issues` (read + notes only), rate limit, `docs/runbooks/AI-CHECKUP.md` with the Claude Routine prompt | auth (non-session API) | API auth tests, secret scan (no key in fixtures) |

### V — "Evergreen Signature" redesign
| PR | Work units | Risk area | CI watch |
|---|---|---|---|
| V-1 | V-2 tokens + contrast test, V-3 site-content fields + `tests/public-copy-from-settings.test.ts` | screens (foundation) | lint guard (`scripts/check-e2-ui-tokens.mjs`), website-editor tests |
| V-2 | V-4 home page + V-6 address check (pure check, action, rate limit) | screens + public form | public axe routes, lead-form spec, rate-limit tests; Chris's before/after screenshot gate |
| V-3 | V-5 remaining public pages | screens | public axe routes, 360px overflow assertions |
| V-4 | V-7 desk Today timeline, sidebar search trigger, portal home + V-8 docs and screenshots | screens | desk/portal axe routes, `desk-workspace`, `owner-portal-workspaces`, `e2e/signature-focus.spec.ts` |

### F-part-2 (after G, T and V merge)
| PR | Work units | Risk area | CI watch |
|---|---|---|---|
| F2-a | WU-F3 scenarios 1–5 (include tax-ready fixtures from T-3) | cross-cutting tests | unit shard time — add a vitest shard if any shard passes ~2 min |
| F2-b | WU-F3 scenarios 6–10 | cross-cutting tests | same |
| F2-c | WU-F6 owner guide rewrite and screenshots | docs/browser | screenshot spec shard assignment |
| F2-d | WU-F7 review-thread discharge, WU-F8 launch ledger, WU-F9 rollback plan and STATUS | docs/scripts | launch-ledger test |

### K — books (after launch unless Chris asks sooner)
| PR | Work units | Risk area | CI watch |
|---|---|---|---|
| K-1 | WU-K1 migration + seeded accounts + WU-K2 account map and posting rules (pure) | schema + pure logic | migration drill, backup coverage |
| K-2 | WU-K3 poster, periods, integrity check, opening balance | money (journal) | concurrency tests (two posters at once) |
| K-3 | WU-K4 Stripe balance sync and clearing check | provider | fake Stripe client tests; automation tests |
| K-4 | WU-K5 expenses, recurring drafts, receipt photo, use-tax hook | money + uploads | upload/private-media tests, STAFF permission tests |
| K-5 | WU-K6 exports + accounts/mapping screen | money + screens | route inventory, CSV formula-injection test |
| K-6 | WU-K7 depreciation | money | appliance retirement tests |
| K-7 | WU-K8 P&L, balance, payback | reports | METRICS registry tests, reports page specs |
| K-8 | WU-K9 forecast, customers, year-end + WU-K10 docs | reports | same; `e2e/books.spec.ts` shard |

### M — shop sales and appliance endings (`docs/designs/BATCH-M.md`, approved 2026-10-07; after K — Chris will not sell before launch, IN-47 answered 2026-10-07)
| PR | Work units | Risk area | CI watch |
|---|---|---|---|
| M-1 | WU-M1 items for sale on the parts ledger, resale stock and use tax on withdrawals, Sales page (pickup vs delivered tax, delivery fee), revenue split | money + screens | parts ledger tests, invoice/tax tests, delivery-fee tests, new browser spec shard |
| M-2 | WU-M2 retired appliances — "what's next" (sell / strip for parts / scrap / throw away / other), parts kept into stock, lump scrap money, K postings | money + inventory | inventory status tests, parts ledger tests, K posting tests |
| M-3 | WU-M3 card payment for local invoices (Stripe Checkout per local invoice) | money + provider | checkout/webhook tests, provider-operation idempotency tests |

### O — owner controls
| PR | Work units | Risk area | CI watch |
|---|---|---|---|
| O-1 | WU-O1 settings history and undo + WU-O6 switches page (the batch's migration) | settings | settings save tests, route inventory |
| O-2 | WU-O2 capabilities (behaviour must not change: table test of today's guards) | permissions | **every permission test**; staff-security spec |
| O-3 | WU-O3 approvals | money + permissions | refund/credit/write-off integration tests |
| O-4 | WU-O4 scheduled prices + WU-O5 goals and alerts + docs | settings/automation | pricing tests, Today tests |

**42 PRs in all** (Batch M adds 3; Batch S adds 2; T-6d by Amendment D; T-6 split into T-6a/T-6b by Amendment A, T-6c added by Amendment B and T-5b by Amendment C, 2026-10-07) (a few more if G-2 or T-4 split). At two merged PRs per session that is roughly 21 working sessions;
each PR should reach green with at most one red CI run (each run is about 3–5 minutes). If a PR needs a third red run,
the agent stops and reports (PLAYBOOK Step 8).
