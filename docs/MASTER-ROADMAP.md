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
| 3 | ⏳ **G** — audit fixes, dark-mode contrast fix, two-step login, session control | proposed (`BATCH-G.md`) | Chris approves G | approve design (IN-40) | 2 |
| 4 | ⏳ **T** — Colorado sales and use tax | proposed (`BATCH-T.md`) | Chris approves T | approve design; register on SUTS for the free GIS key (can come later — manual entry works) | 4 |
| 5 | ⏳ **V** — "Evergreen Signature" public-site redesign + desk/portal polish | proposed (`BATCH-V.md`, concept artifact) | Chris approves V | approve design; react to the concept | 3–4 |
| 6 | ○ **F-part-2** — end-to-end scenarios, owner guide with screenshots, review-thread discharge, launch ledger, rollback plan (WU-F3, F6–F9) | ✅ approved | steps 3–5 merged (so the proof covers the final product) | nothing | 3 |
| 7 | ⏳ **Launch** — Chris's go-live checklist | `docs/GO-LIVE-CHECKLIST.md` | step 6 done | CPA answers IN-17, IN-33…IN-38 entered; attorney wording; live Stripe/email decisions; launch authorization | — |
| 8 | ⏳ **K** — books: journal, expenses, Stripe fees, P&L, QuickBooks/Xero/other exports | proposed (`BATCH-K.md`) | T merged; Chris approves K (may move before launch if wanted) | approve design; IN-39 later | 5 |
| 9 | ⏳ **O** — owner controls: settings undo, per-person permissions, approvals, dated prices, goals, switches page | proposed (`BATCH-O.md`) | K merged; Chris approves O | approve design | 4–5 |
| 10 | ○ **P** — customer self-service and growth (section 5) | **no design yet** — a stronger model writes it when Chris picks items | after O, or earlier for a single picked item | pick items | — |
| 11 | ○ Conditional/deferred: Google Workspace integration (O32), CSV import (O29), direct QuickBooks sync (`BATCH-K.md` §9) | deferred | prerequisites in their docs | provide accounts/data | — |

**Why F is split (needs Chris's OK, recorded as IN-41):** F proves the finished product. If F runs completely now, the
tax, security and redesign work that follows would make its scenarios and screenshots stale. Its infrastructure parts
(backup/restore, media copy, capacity, runbooks) do not depend on those batches, so they run now; its product-wide
proof runs last. If Chris prefers, F can run whole now and the scenario/screenshot work units are re-run after V.

**If Chris has not approved G/T/V yet:** do step 2, then stop and report. Never start a PROPOSED design.

## 3. How an implementing model runs a step

Paste into a new session (replace `<X>`):

> Read AGENTS.md, docs/START-HERE.md, docs/STATUS.md, docs/MASTER-ROADMAP.md, then docs/designs/BATCH-<X>.md in full.
> Do the design drift check (section 0 of the design and docs/designs/README.md) and record it in the first PR. Build
> the work units in order as a stack of PRs, one PR per group the design names, following docs/PLAYBOOK.md. Do not
> re-decide anything in the design's Decisions section, do not add anything it does not name, and stop and ask Chris at
> every stop-and-ask point. Never enter a tax rate, a tax answer, a price or a legal promise yourself. After each PR:
> exact-head CI green, review threads read and dispositioned, then merge per AGENTS.md. At the end update
> docs/STATUS.md and tick the step in docs/MASTER-ROADMAP.md, and report to Chris in plain English.

For F-part-1 use the same prompt with `BATCH-F.md` and add: "Build only WU-F1, WU-F2, WU-F4 and WU-F5 now."

## 4. Chris's action queue (only Chris can do these; nothing here is urgent unless a step is waiting)

| ID | What | Blocks |
|---|---|---|
| IN-40 | Approve, change or reject designs G, T, K, O (`docs/plans/TAX-AND-BOOKS-OVERVIEW.md`) | steps 3, 4, 8, 9 |
| IN-42 | Approve or change design V and the Evergreen Signature concept | step 5 |
| IN-41 | OK the F split (section 2) | order of steps 2 and 6 |
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
