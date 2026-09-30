# Owner inputs and launch decisions

Updated 2026-09-30. This is the project decision register, not a claim that
these items have been entered into the live app's Tasks screen. Chris asked
that work requiring his input be recorded rather than repeatedly interrupting
implementation. Update this file when an answer is supplied; reference the
ID from HANDOFF and the affected build task. Never store passwords or keys here.

Status meanings: **Awaiting Chris** = an actual choice or supplied item is
needed; **Verify existing** = check the existing decision/configuration first,
then ask only if unresolved; **Optional later** = does not block launch.
Only ask for the inputs needed by the next release. Do not ask all at once.

| ID | Status | Input or decision | What it blocks | Safe work while waiting |
|---|---|---|---|---|
| IN-01 | Awaiting Chris | Business mailing address approved for the footer of marketing emails. Do not assume a home address or publish one from another record. | Enabling the welcome sequence and marketing broadcasts | Keep email delivery OFF; signup capture and preview can be reviewed |
| IN-02 | Awaiting Chris | Confirm the monitored reply-to address and public customer email. ARCHITECTURE documents an existing Workspace mailbox and `support@robinsonappliancerentals.com` alias; that is a candidate, not a newly chosen setting. Confirm replies reach the business inbox. | Email activation and replacing the public personal email | Configure/test forms in isolated environments; no new paid mailbox needed by this plan |
| IN-03 | Awaiting Chris | Final public business phone number and when to replace the currently configured personal number | Public contact replacement, listings, SMS sender decisions | Do not invent a number or silently remove a working contact route |
| IN-04 | Awaiting Chris | Review/approval to put PR #86 prelaunch pages live; welcome-email activation is a separate decision | Production merge of that phase | Preview and testing are complete; no auto-merge |
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

## Confirmed facts — do not ask again

- Small family business, preparing to launch; Greeley and surrounding area.
- Washers/dryers are the initial focus. Maintenance is always included.
- Delivery and installation are offered; free service depends on the situation.
- Evergreen v2.0 is the current branding. Do not revive the navy/teal proposal.
- Chris is not a developer and wants routine website/business changes handled
  through the owner interface once built.
- The implementation must follow AGENTS.md, preserve working features, use
  reviewed branches/PRs and report before the next phase.

## How to close an input

Record the date, exact approved choice, affected setting/document, and who
verified the result. An answer does not automatically mean it was applied.
Use “answered; application pending” until the setting and resulting behavior
have been verified. Do not change this register into an unattended to-do agent.
