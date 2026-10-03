# Appliance Desk — PR #161 Independent Design and Code Review

Review date: October 3, 2026 (America/Denver)
Repository: christcr2012/appliance-desk
Branch: ai/claude/batch-b-renewal-notices
PR: https://github.com/christcr2012/appliance-desk/pull/161
Reviewed head: b1f857208589e5e82309aee3027e5fbd758872ea
Compared main: 16ece65b71752be97c54855aa32bb54551639c4b

## Owner summary

**Recommendation: request changes. Do not treat this feature as approved for live automatic renewals yet.**

The reminder checks improve safety, but they do not make the whole renewal process safe. Conflicting Stripe updates can restart billing after cancellation or stop a replacement renewal. A crash can lose the instruction to restore the old billing stop date. After the first automatic renewal, the customer's stop-renewal button disappears, and the continuing monthly rental falls out of the reminder process.

Seven findings below describe code or operational defects; the annual-notice finding also needs confirmation of the applicable legal schedule. Two additional design/legal questions need resolution before approval. Several defects predate this PR and already exist in main. This is a review of the combined feature, not a claim that #161 introduced every issue.

No repository code or documentation was changed, no PR comments were posted, no production systems were exercised, and no messages or charges were sent.

## Scope and evidence

Reviewed the requested rules, decisions IN-19–IN-25, go-live checklist, AGENTS.md, the approved Batch B design, design handoff/drift instructions, current status and plan, security/billing audit, PR diff and prior review comments. The attached Package 1 report informed the evidence/fix/test format; its October 1 findings were not treated as proof of current defects.

Traced creation, delivery, manual delivery, opt-out, renewal start, subscription extension/restoration, provider-operation recovery, relevant subscription webhooks, account/Desk entry points, schema, cron schedule, and targeted tests.

**Verification performed:**

- Read the actual source at the pinned head, including related code already in main.
- Compared main's renewal-copy, cancellation and subscription-term implementations with the PR.
- Executed isolated Node simulations of the downloaded, actual TypeScript functions after removing imports and stripping type syntax. Database/provider dependencies were replaced with controlled in-memory fakes; no application initialization, network providers or database connections were involved.
- Reproduced consent-OFF extension eligibility; extend/revert completion inversion; missing continuation consent/terms fields; out-of-window notice sending; and starvation behind 200 failed notices.
- Executed the actual date helpers against March/November DST boundaries, 24/25/40/41 calendar-day distances, August 31 plus six months, and a January 31 billing anchor.
- GitHub reports the exact head's ci check, all unit shards, all browser shards, static checks and secret scan successful: https://github.com/christcr2012/appliance-desk/actions/runs/37147476153
- At the last check, PR head and main were unchanged and #161 remained open.

**Limits:** I did not independently rerun the full real-Postgres/browser suite or exercise a deployed preview. The simulations establish the named control-flow defects; they are not substitutes for database concurrency tests. Green CI establishes that the existing tests passed, not that these uncovered cases are safe. This report is not legal approval.

## Findings — most serious first

### R1 — HIGH: conflicting subscription updates can undo a customer's cancellation or a newer renewal

**Where:** [subscription-term.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/billing/subscription-term.ts#L93), `desiredSubscriptionTerm`, `syncSubscriptionTerm`, `termSyncKey`; [reconciliation.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/billing/reconciliation.ts#L237), `reconcileSubscriptionUpdate`; [auto-renew.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/auto-renew.ts#L217), `extendBillingForDeliveredAutoRenewals`.

**Present on main:** The separate extend/revert operation design predates #161. This PR adds the reminder test but does not order opposing updates.

**What goes wrong:** Each renewal/direction gets a separate provider-operation key. That prevents duplicate copies of one operation; it does not order different operations affecting the same Stripe subscription. The desired end date is read before the provider call, and there is no final reconciliation against the newest agreement intent.

Concrete sequence:

1. An extension reads a valid, delivered reminder and starts removing Stripe's stop date.
2. The customer turns auto-renew off; cancellation restores the original stop date.
3. The slower extension finishes last and removes that stop date again.
4. Both operations are recorded as successful. The ordinary pending-operation worker does not revisit successful rows.

The customer can then remain billable beyond the old term despite opting out. **This completion order was reproduced with the real sync function and a paused fake Stripe call.**

There is also a simpler eligibility gap: `desiredSubscriptionTerm` does not check current consent, termination request or the old agreement's ACTIVE status. A queued renewal left behind during cancellation recovery can still be extended. The independent extension loop and reconciliation reach this resolver without the wrapper's consent check.

In the reverse direction, a delayed revert for cancelled renewal A still restores the old term even after replacement renewal B has successfully extended billing. The resolver does not look for the current replacement. That can stop billing early.

**Suggested fix:** Maintain one current, versioned billing-end intent per subscription. Serialize provider work for that subscription, derive it from current consent/termination/current successor, and reconcile again after completion if intent changed. Make obsolete operations explicitly superseded. Checking consent once before a network call is necessary but insufficient.

**Required regression tests:** Pause extension, complete cancellation/revert, resume extension; fail old revert, enable a new renewal, then retry old revert; withdraw consent with the cancellation step temporarily failing. Assert both the final provider stop date and the final local lifecycle.

### R2 — HIGH: a crash after local cancellation can permanently lose the billing-stop restoration

**Where:** [agreements/index.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/index.ts#L569), `closeAgreement`, especially the post-transaction `syncSubscriptionTerm(..., "revert")`; [auto-renew.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/auto-renew.ts), `cancelWithdrawnAutoRenewals`; [reconciliation.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/billing/reconciliation.ts#L663), `finishPendingProviderOperations`.

**Present on main:** Yes.

**Example:** The timely notice has already allowed Stripe's stop date to be cleared. A customer opts out. The renewal is committed as CANCELLED, then the process dies before `syncSubscriptionTerm` creates the revert operation.

There is now no saved revert for reconciliation to retry. The nightly cancellation scan selects SCHEDULED renewals, so it skips this already-cancelled one. The local record says cancelled while Stripe can continue charging.

The comment saying the “recorded provider operation” will retry is only true if execution reached the later claim.

**Suggested fix:** Persist the required subscription-end change in the same database transaction as cancellation. Have a worker execute that durable instruction after commit. The recurring reconciliation should also detect missing instructions by comparing current business intent to provider state.

**Required test:** Inject a process-stop boundary immediately after cancellation commits and before any provider claim; run recovery with a fresh worker and prove the original stop date is restored once.

### R3 — HIGH: the customer loses the online cancellation control after the first renewal starts

**Where:** [renewal-data.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/renewal-data.ts), `renewalCreateData`; [renewal-start.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/renewal-start.ts), `startRenewalInTx`; [account/rentals/page.tsx](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/app/account/rentals/page.tsx), `AccountRentalsPage`; [term.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/term.ts#L408), `setAutoRenew`.

**Present on main:** The omission in the renewal copy is already present. The new portal button exposes its consequence.

**Example:** A twelve-month rental becomes a monthly rental. The new agreement copies prices and equipment context but not `renewalPreference`, consent fields or `termsSnapshot`. Those fields default to null. The old agreement becomes ENDED. The portal shows the stop-renewal button only for ACTIVE agreements whose preference equals AUTO_RENEW. Consequently, neither record shows the button.

Calling the action on the old agreement fails because it is no longer ACTIVE. Even directly disabling the new agreement would only change a preference: there is no fixed-term successor to withdraw and no continuing-rental cancellation command behind that action. “Request pickup” explicitly does not cancel the agreement or change billing.

**Suggested fix:** Design cancellation for the continuing monthly rental, preserving the connection to original consent and the applicable agreed terms. Give the customer a real cancellation request with a clearly recorded effective date and provider follow-through. Do not merely copy AUTO_RENEW to make a button visible, or blindly copy fixed-term penalties into monthly terms.

**Required test:** Complete the fixed-to-monthly rollover, sign in as that customer, cancel from the account, and prove the effective cancellation, confirmation and billing-end intent. Include cancellation racing the rollover.

### R4 — HIGH, legal schedule to confirm: reminders stop after the fixed-to-monthly conversion

**Where:** [auto-renew.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/auto-renew.ts), `runAutoRenewals` and `createAutoRenewal`; [renewal-data.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/renewal-data.ts), `renewalCreateData`; [renewal-reminder.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/notices/renewal-reminder.ts), `renewalReminderKey`.

**Scope:** A lifecycle gap in the combined feature; this PR supplies only the first fixed-term reminder.

**Example:** A customer remains for three years. After the first rollover, the original agreement is ENDED; its successor has `termMonths = null` and no end date. The job requires an ACTIVE fixed term with an end date, so it never creates another renewal reminder for that ongoing rental.

C.R.S. 6-1-732(4)(b) treats renewals shorter than twelve months differently: notices relate to crossing the first and subsequent continuous twelve-month periods. A reminder before month seven does not cover the later annual boundary. Have counsel confirm the exact schedule for these contracts. [Statutory text](https://olls.info/crs/crs2025-title-06.htm).

**Suggested fix:** Track the continuous rental's original start/anniversary across replacement agreement records, and generate independently deduplicated notices for each required annual boundary. Keep any extra six-month reminder if the business wants it.

**Required tests:** Six-month-to-monthly through month 13; twelve-month-to-monthly through months 25 and 37; a rental monthly from the outset; agreement replacement must not reset the continuous period.

### R5 — MEDIUM: turning email on late sends a renewal promise that the system then refuses to honor

**Where:** [notices/index.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/notices/index.ts#L73), `sendPendingNotices`, `stillNeeded`, `checkReminderDelivered`, `listWaitingNotices`; [auto-renew.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/auto-renew.ts), `autoRenewWindowOpen`; [renewal-start.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/agreements/renewal-start.ts), blocked-renewal messages.

**Introduced in #161:** Yes.

**Example:** Renewal starts November 8. Email stays off until October 29. The sender sees a SCHEDULED renewal and sends “your rental will continue month to month” even though only ten calendar days remain. The delivery guard correctly rejects it as out of window, so automatic renewal and extension stay blocked.

The sender never checks the allowed dates. The creation window also permits late creation right up to term end. After sending, the notice is SENT and disappears from the pending-only Notices screen; there is no ordinary correction/reissue path. The “send it ... and the renewal will start on its own” guidance is false once the window has been missed.

**Suggested fix:** Check current consent, renewal identity and permissible dates before delivery. Route expired notices to a visible “missed deadline—owner action needed” outcome without sending the old promise. Show an explicit resolution flow: cancel the queued renewal or obtain a fresh, approved agreement; do not silently backdate or move dates.

**Required test:** Enable email at 24 days, ten days and after the planned renewal start; assert zero stale renewal promises and a visible, actionable blocked outcome. The ten-day case was reproduced with the actual sender and check functions.

### R6 — MEDIUM: uncertain email delivery can duplicate messages and corrupt the recorded notice date

**Where:** [notices/index.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/notices/index.ts#L73), `sendPendingNotices`; [email.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/lib/email.ts), `sendEmail`; [schema.prisma](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/prisma/schema.prisma#L1435), `CustomerNotice`; `vercel.json`.

**Introduced in #161:** The notice worker and evidence model.

**Example:** Resend accepts the reminder but the process dies before saving SENT, or the save fails and the catch resets PENDING. The next daily run sends with the same key. Resend retains idempotency keys for 24 hours, so a delayed next-day retry can send a second message. A recovered response is recorded with the retry's current time, not the original acceptance time: a valid day-25 notice can become an apparently invalid day-24 notice.

There is no stored provider message ID or immutable attempt payload/acceptance time to reconcile. Recipients are reread on retry, so an email-address change can also change the payload under the same key. If cancellation happened after the uncertain send, `stillNeeded` can mark the notice NOT_NEEDED without recovering evidence that it was actually accepted.

The 15-minute claim timeout does not mean recovery happens in 15 minutes: the configured worker is daily. Completions are matched by status only, not by the worker's claim identity.

**Suggested fix:** Distinguish “definitely not sent” from “outcome unknown”; save immutable send attempts, provider IDs and timestamps; recover accepted delivery before resending; fence completion by attempt/claim. Surface uncertain attempts for review. Schedule safe recovery within the provider's deduplication period or stop blind retries beyond it.

**Required tests:** Acceptance followed by DB failure; process loss before provider response; retry inside and outside 24 hours; recipient changes; cancellation during uncertain delivery; stale worker completion after takeover.

**Provider basis:** [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys) documents the 24-hour retention and payload-conflict behavior. These are provider constraints, not guarantees supplied by the application.

### R7 — MEDIUM: 200 failing notices can prevent every newer notice from ever being attempted

**Where:** [notices/index.ts](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/src/domains/notices/index.ts#L73), `sendPendingNotices`.

**Introduced in #161:** Yes.

**Example:** The oldest 200 messages fail every time because their recipients are invalid or their requests are rejected. Each returns to PENDING. Every daily run chooses the same oldest 200 again; customer 201, with a valid address, is never attempted and can miss the deadline.

**Suggested fix:** Add retry scheduling/backoff and bounded attempts per run, advance fairly through eligible work, and prioritize deadlines. Park permanent failures visibly rather than allowing them to occupy the front forever. Do not solve this by loading an unbounded list.

**Required test:** 201 pending notices with the first 200 failing; the valid last one must still be attempted in a bounded number of runs. The starvation was reproduced against the actual sender using an in-memory query fake.

## Design and legal approval gaps

### D1 — The approved design does not specify this completed lifecycle

[AGENTS.md](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/AGENTS.md) and [designs/README.md](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/docs/designs/README.md) require an approved design before decision-level implementation. Batch B's original D10/WU-B10 describes policy-parameterized mechanisms; it does not specify this notice state machine, first-to-continuing-rental handling or the provider ordering described above. The checked-in [review prompt](https://github.com/christcr2012/appliance-desk/blob/b1f857208589e5e82309aee3027e5fbd758872ea/docs/prompts/REVIEW-RENEWAL-NOTICES.md) expressly acknowledges the missing design review. DECISIONS calls this stronger-model review optional, which does not settle the missing approved amendment.

**Required disposition:** Produce a dated Batch B design amendment covering these findings, permissible notice evidence, ongoing cancellation, recurring notice schedule, missed windows and recovery. Link acceptance tests and unresolved owner/legal decisions. An entry in the decisions log or a green test suite is not equivalent to that design.

For later batches, the documented process is: check the approved design against current code before implementation; amend ordinary drift; seek a stronger-model decision for material conflicts. It is not an unconditional instruction to perform a new full-project audit before every PR.

### D2 — “Delivered” and allowed manual delivery need an explicit evidence rule

`markNoticeDeliveredByHand` accepts any description of at least two characters, with “phoned” offered as an example. That entry alone can unlock renewal and billing. Email SENT means provider acceptance; the wrapper discards the message ID and does not establish receipt or handle a later bounce.

The statute lists mail, email and conditionally authorized/customary alternative channels. A generic phone-call note is not automatically proof those conditions were satisfied. Define allowable channels and evidence with counsel; do not assume provider acceptance equals legal delivery. Also review the extra confirmation click and cancellation availability under the amended online-cancellation rule. [Statutory text](https://olls.info/crs/crs2025-title-06.htm); [SB25-145](https://leg.colorado.gov/bills/sb25-145).

I have not determined whether a particular phone interaction satisfies the statute, whether a particular bounce defeats notice, or how cancellation/pickup obligations interact legally. Those are legal-review questions, not grounds to declare the software compliant.

## What is working in the inspected paths

| Check | Evidence and practical limit |
|---|---|
| Owner authorization to enable customer email | OWNER-only server action plus in-transaction active-role check and audit. Missing setting means off. The inspected notice sender uses this wrapper. |
| Preview email protection | sendEmail returns before creating a provider client for a Vercel preview/nonproduction marker. This is a code-path check, not a test of production settings. |
| Customer isolation for opt-out | Session identity is used; the domain rechecks active CUSTOMER role and agreement ownership under transaction locks. Customer A cannot use this action to alter B's agreement. |
| Desk access | Notices page/action require OWNER or ADMIN. Manual delivery rechecks the active team actor inside the write transaction. STAFF's exception query does not load notices. |
| Initial renewal deduplication | The old agreement is locked before eligibility/existing-successor checks; notice creation and renewal creation share a transaction and notice dedupeKey is unique. |
| Normal concurrent notice claim | Conditional status plus updatedAt claim prevents two ordinary workers from winning the same initial send. This does not solve uncertain delivery or stale-claim takeover. |
| Ordinary cancellation withdrawal | Pending notice withdrawal is inside the renewal-cancellation transaction. An in-flight send is left available to record a later success. R2 concerns the separate provider restoration. |
| Ordinary no-notice billing guard | A missing or out-of-window notice blocks both startRenewalInTx and desiredSubscriptionTerm for a noncancelled automatic renewal. The original unconditional-extension review issue is addressed in that path. |
| Agreed notice wording | Reminder content is saved once from the original agreement's terms snapshot; later global wording edits do not rewrite the stored reminder. |
| Colorado date math | Actual helpers passed the named DST and calendar-boundary checks. Month arithmetic derives each anniversary from the original anchor, preventing January-31-to-February-to-March drift. This does not prove Stripe billing timestamps match every local anniversary. |
| Prepaid protection | Paid-in-advance agreements are excluded from automatic continuation. |
| Local rollover integrity | startRenewalInTx locks customer and agreements, checks prerequisites, pairs lines, and moves assignments/subscription/deposit in one transaction. It rejects unexpected existing assignments on new lines. Missing continuation fields are R3. |
| No second renewal deposit | New renewal data has depositCents zero; existing deposit records move during rollover. |
| Provider recovery foundation | Single-operation claims, UNKNOWN handling and recorded errors exist. The missing pieces are durable intent at every lifecycle commit and ordering across operations, not a need to replace all billing code. |

## Notice-state review

| Current transition | Result of review |
|---|---|
| New → PENDING | Transactionally created with automatic renewal. |
| PENDING → SENDING | Conditional claim prevents the ordinary duplicate-claim race. |
| SENDING → SENT | Records provider acceptance with local completion time; R6 applies. |
| SENDING → PENDING | Known failure is retryable, but uncertain outcomes are incorrectly treated the same way. |
| Stale SENDING → reclaimed SENDING | Retried after 15 minutes of age, but normally only at the next daily run; no claim-specific completion guard. |
| PENDING → SENT by hand | OWNER/ADMIN only, audited, actual date accepted; channel/evidence policy unresolved. |
| PENDING → NOT_NEEDED | Withdrawn atomically with cancelled automatic renewal. |
| SENDING → NOT_NEEDED on worker check | Suppresses unnecessary fresh sending, but may discard uncertain previous-send evidence. |
| NOT_NEEDED → PENDING | Re-enabling auto-renew revives the same saved reminder. |
| SENT | Terminal in the supplied workflow. A late/incorrectly recorded notice cannot be corrected or superseded through the Notices screen. |
| In-flight send when cancelled | A successfully persisted delivery remains evidence; a failed attempt can return to PENDING until a later worker withdraws it. |

## Prior-review continuity

The initial PR feedback led to real improvements visible at this head: owner email gate; actual manual date input; calendar-day delivery guard; initial send claim; transactional pending-notice withdrawal; OFF→ON notice reactivation; and a customer opt-out action. R1–R7 identify remaining or related gaps, not repetitions of the original unfixed code.

The earlier estimate-email finding is only **partially resolved / behavior changed**: the action now tells the owner to share the link when email was not sent, and follow-ups check sent=false. The estimate itself still transitions to SENT before email delivery and does not gain a normal resend path. This is outside the renewal findings, but should not be represented as full delivery/outbox remediation. Treat that behavior as an explicit business decision or keep the older audit item open.

The one review comment retrieved on predecessor #160 concerns successful payment-status spellings in a test; it is outside this renewal analysis. This report does not claim to resolve or certify every historical review thread.

## Questions for Chris

1. **If a reminder deadline is missed, should the default be to stop automatic renewal and ask the customer to approve a fresh agreement?** Recommendation: yes; show you the problem before the old term ends. Counsel should approve the recovery wording.
2. **May an admin certify delivery by hand, or should only you be allowed to do that?** Current code allows both; the request's wording sometimes says owner only.
3. **Should the monthly continuation carry forward the previous cancellation-notice rule until a properly notified change takes effect?** This connects to your still-open IN-21 decision. Do not automatically carry over the old fixed-term early-ending fee.
4. **When live email is enabled, should expired reminders go to your review queue instead of being sent?** Recommendation: yes; only still-valid notices should send automatically.

You do not need to choose database locks, retry keys or worker design. Those are implementation decisions. Your existing IN-24 pickup/return billing rule remains a Batch C requirement; this review does not replace it or ask you to decide it again.

## Minimum repair and re-review acceptance

1. Approved amendment resolves R1–R7 and D1–D2, or explicitly blocks affected activation pending counsel/owner input.
2. Cancellation and termination persist their provider intent with the local decision.
3. Per-subscription recovery proves newest valid intent wins across competing, failed and ambiguous operations.
4. Customer cancellation remains usable after rollover; recurring reminder obligations follow the continuous rental.
5. Late, uncertain, failed and stale notices remain visible and actionable without false promises or automatic fabricated evidence.
6. Add the named regression cases to the existing real-Postgres suite; use provider fakes with paused/reordered responses. Add one complete customer rollover-and-cancel browser flow.
7. Re-run normal CI and review the fixed exact head. Preserve owner approval gates for live email/payments and no-production-test rules.

## Sources

Repository references above are pinned to the reviewed commit. Main comparisons use 16ece65b71752be97c54855aa32bb54551639c4b.

- Colorado statutory text, section 6-1-732: https://olls.info/crs/crs2025-title-06.htm
- Colorado legislature, SB25-145: https://leg.colorado.gov/bills/sb25-145
- Resend idempotency keys: https://resend.com/docs/dashboard/emails/idempotency-keys

The legal sources support the stated review questions; they do not constitute a legal opinion about this business's particular agreement.

