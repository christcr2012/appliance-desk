# Owner inputs and launch decisions

Updated 2026-10-02. This is the project decision register, not a claim that
these items have been entered into the live app's Tasks screen. Chris asked
that work requiring his input be recorded rather than repeatedly interrupting
implementation. Update this file when an answer is supplied; reference the
ID from `docs/STATUS.md`, the PR description and the affected batch in
`docs/PLAN.md`. Never store passwords or keys here.

Status meanings: **Awaiting Chris** = an actual choice or supplied item is
needed; **Verify existing** = check the existing decision/configuration first,
then ask only if unresolved; **Optional later** = does not block launch.
Only ask for the inputs needed by the next release. Do not ask all at once.

| ID | Status | Input or decision | What it blocks | Safe work while waiting |
|---|---|---|---|---|
| IN-01 | Awaiting Chris | Business mailing address approved for the footer of marketing emails. Do not assume a home address or publish one from another record. | Enabling the welcome sequence and marketing broadcasts | Keep email delivery OFF; signup capture and preview can be reviewed |
| IN-02 | Awaiting Chris | Confirm the monitored reply-to address and public customer email. ARCHITECTURE documents an existing Workspace mailbox and `support@robinsonappliancerentals.com` alias; that is a candidate, not a newly chosen setting. Confirm replies reach the business inbox. | Email activation and replacing the public personal email | Configure/test forms in isolated environments; no new paid mailbox needed by this plan |
| IN-03 | Awaiting Chris | Final public business phone number and when to replace the currently configured personal number | Public contact replacement, listings, SMS sender decisions | Do not invent a number or silently remove a working contact route |
| IN-04 | Completed for PR #86; email activation separate | PR #86 merged 2026-09-30. Chris also authorized Codex to merge its own verified PRs as it goes. | Welcome-email activation still needs IN-01/IN-02 | Preserve the separate email/live-payment/paid-resource gates |
| IN-05 | Awaiting Chris | Actual opening date, first available inventory, and launch announcement timing | Public opening promises and launch broadcast | Continue truthful “preparing to launch” messaging |
| IN-06 | Verify existing | Final service cities/ZIPs, delivery/installation requirements, fee-waiver conditions and any operating hours. Reuse current business settings; ask only about missing or contradictory rules. | Revised customer-facing promises and delivery configuration | Preserve existing rules; describe fees as situation-dependent |
| IN-07 | Verify existing | Legal business details and required approval of rental terms/tax configuration; inspect existing decisions first | Public legal identity changes and revised terms | Preserve approved terms, fee rules and current tax-confirmed gate; do not invent legal/tax advice |
| IN-08 | Awaiting Chris when launch-ready | Explicit approval to enable live Stripe payments, after the existing test flow is demonstrated | Real charges | Stripe remains in test mode; UI work must not alter billing semantics |
| IN-09 | Verify existing before SMS | Current Twilio registration/sender status and approval to activate messages | Live SMS | Existing SMS implementation remains dormant; avoid a second SMS integration |
| IN-10 | Optional later | Real family/business/vehicle photos Chris is comfortable publishing, with permission for everyone shown | Family portrait or field photography sections | Use approved logo/appliance assets; no invented staff photos or testimonials |
| IN-11 | Optional later | Genuine customer reviews and permission to feature them | Testimonials | Omit the section until real reviews exist; no fabricated proof |
| IN-12 | Awaiting Chris at rollout | Review the new Today, customer, and mobile field workflows using the preview | Release of the UI overhaul | Implement the specified reversible preview tasks; do not require Chris to choose spacing or technical architecture |
| IN-13 | Optional later, triggered by hiring | Actual staff responsibilities and desired access boundaries | New dispatcher/technician/billing role rollout | Preserve OWNER/ADMIN/STAFF; verify current protections and keep financial access restricted |
| IN-14 | Optional later, triggered by demand | First real portfolio account's unit/contact/consolidated-charge requirements | A new unit hierarchy or consolidated Stripe charge feature | Existing multiple service addresses, contacts and consolidated statements remain available |
| IN-16 | Answered; Claude verification pending | 2026-09-30: Chris reports Robinson Google Workspace is connected as a personal plugin and Claude can use it. Delegate Workspace setup to Claude; do not ask Chris to reconnect it for ChatGPT. Claude verifies intended business identity and Admin privileges (GW-01). | Verified connector-assisted setup | Follow plans/overhaul/CLAUDE-WORKSPACE-SETUP.md; core overhaul continues independently |
| IN-15 | Awaiting Chris only if needed | Approval of any additional paid service, higher hosting tier or storage purchase | Spending | Prefer existing services; record measured limits before recommending a purchase |
| IN-17 | Answered; implemented in Batch B WU-B10 | 2026-10-02: sales-tax rates must support **thousandths of one percent**. Example: `7.375%` is stored as integer `7375`; owner-facing inputs remain ordinary percentages. Preserve the existing tax-confirmed gate and never guess the applicable rate. The Batch B migration multiplies legacy tenths-percent stored values by 100 so their effective rates do not change. | Nothing; owner precision decision is complete. | Keep per-line half-up rounding and exact thousandth-percent storage/math. The legacy field name `taxRatePermille` remains for compatibility even though its unit is now thousandths of a percentage point. |
| IN-18 | Release operation after Batch B merge; **no owner decision required** | After the Batch B production migration is confirmed healthy, run `scripts/backfill-receipts.ts --confirm` once against production, verify every historical successful Payment now has a Receipt, then run it a second time and require a no-op result. Failed payment attempts intentionally remain without receipts. | Historical cash-receipt completeness for reconciliation/reporting | Do not run before the receipt migration is deployed. New payments already write Receipts transactionally, so normal operation can be tested independently. |
| IN-19 | Awaiting Chris before Batch D policy UI/activation | Choose the actual early-termination and renewal policy values/texts: flat fee and/or percent, optional fee cap, notice days, treatment of unused prepaid term (`REFUND`, `CREDIT`, or `RETAIN`), customer-facing termination terms text, and the auto-renew terms/version text. Batch B provides the locked quote/renewal/consent mechanisms but intentionally does not invent these business terms. | Batch D owner/customer controls that expose or activate termination/auto-renew policy; not Batch B domain plumbing | Keep policy fields null. `loadTerminationPolicy()` returns unavailable while required values/text are unset; disabling auto-renew remains safe and never cancels an agreement. |

## Confirmed facts — do not ask again

- Small family business, preparing to launch; Greeley and surrounding area.
- Washers/dryers are the initial focus. Maintenance is always included.
- Delivery and installation are offered; free service depends on the situation.
- Evergreen v2.0 is the current branding. Do not revive the navy/teal proposal.
- Chris is not a developer and wants routine website/business changes handled
  through the owner interface once built.
- The implementation must follow AGENTS.md, preserve working features, use
  reviewed branches/PRs and report before the next phase.
- Sales-tax precision decision (IN-17): support rates to 0.001 percentage point
  (for example 7.375%) using exact integer-backed storage/calculation. This is
  a precision requirement only, not approval of any particular tax rate.
- Receipt backfill (IN-18) is a release operation, not an owner choice; do not
  interrupt Chris for approval once Batch B's normal release gates are green.
- Early-termination/renewal policy values (IN-19) are intentionally unset until
  Chris chooses them. Do not infer defaults from code, competitors, or old notes.

## How to close an input

Record the date, exact approved choice, affected setting/document, and who
verified the result. An answer does not automatically mean it was applied.
Use “answered; application pending” until the setting and resulting behavior
have been verified. Do not change this register into an unattended to-do agent.
