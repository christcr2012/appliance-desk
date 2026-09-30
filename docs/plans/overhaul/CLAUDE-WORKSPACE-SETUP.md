# Claude handoff: Google Workspace setup register

Updated 2026-09-30. Chris reports Claude can use Robinson Google Workspace.
Delegate the Workspace work below to Claude through that existing connector;
do not block the overhaul on ChatGPT gaining the same access. This document
plans setup; it does not claim any Admin changes or message tests have run.

## Execution contract

Read AGENTS.md, latest HANDOFF, ARCHITECTURE's email address table and
OWNER-INPUTS before acting. Discover actual connector tools and their schemas;
do not invent tool names or assume a connected account has Admin privileges.
Verify the intended domain and business account first. The existing MCP may
serve one linked Google identity; do not replace it or modify another business.

The current instruction authorizes documenting this work. At execution, use
the owner's existing authorization for approved project setup; inspect first,
reuse working resources, and ask only for genuinely missing decisions or
actions requiring approval under AGENTS.md. Never buy seats, change unrelated
tenant-wide policy, broaden OAuth access or send test/customer messages merely
because the tool is available. Record unsupported operations as manual steps
with exact settings and evidence needed, rather than marking them complete.

## Required before public contact/email activation

| ID | Claude's task | Completion evidence / dependency |
|---|---|---|
| GW-01 | Identify connected Google account, Workspace customer/domain, available Directory/Gmail tools and effective privileges. Inspect only metadata needed for this project. | Intended business identity confirmed; supported/unsupported tasks recorded. Never save tokens or customer contents. |
| GW-02 | Inspect the existing `ops@robinsonappliancerentals.com` user and the five role aliases below. Check users, aliases and groups for collisions before creating anything. | Read-back of each address and exact destination. Existing correct aliases are VERIFIED, not recreated. |
| GW-03 | For a missing approved address, create its user alias on the existing business mailbox using Google Admin tools, then read it back. For a collision/wrong destination, document the conflict and proposed repair before reassignment. | Alias resolves to the intended mailbox; no duplicate paid seat, group, domain alias, rename or deletion as a shortcut. |
| GW-04 | Confirm monitored public email and reply-to with IN-02. Inspect Gmail send-as/reply settings for human correspondence if Chris wants to reply from a role address. Configure only supported, approved identities. | Public display, human send-as, application From and application Reply-To documented separately; verification/pending status explicit. An Admin alias alone is not proof of outgoing identity setup. |
| GW-05 | Inspect inbox organization; propose bounded labels/filters for Leads, Support/Maintenance and Billing. Reuse existing filters; do not auto-delete, archive, forward externally or mark urgent requests read. | Approved rules applied once, IDs recorded and sample matching checked without exposing message bodies in Git. Optional; not a reason to delay basic mail delivery. |
| GW-06 | Audit receiving-domain verification/MX and sending authentication for both Workspace and existing Resend. Check SPF, DKIM and DMARC against current official provider instructions; document missing DNS records and the responsible DNS account. | Actual observed configuration and verification state, not assumed success. DNS changes may require a separate provider; do not replace working mail routing or publish duplicate/conflicting records. |
| GW-07 | Reconcile app settings and Vercel variables with the verified addresses. Preserve Resend as the app sender. Track publicEmail, From, Reply-To, lead, maintenance and billing notification destinations separately; inspect actual code before assigning setting names. | Non-secret settings map and environment scope; only approved values applied. Google Admin does not configure Vercel, Resend or app settings automatically. Preserve test/preview isolation. |
| GW-08 | Prepare and, after explicit send authorization, run a small end-to-end mail test with an owner-approved test inbox: receive at each required alias, reply through intended identity, and exercise the relevant app notification in isolation. | Delivery/receipt and reply route confirmed, header authentication results recorded, no accidental real lead/customer or marketing enrollment. A tool success response alone is insufficient. |
| GW-09 | Close launch blockers separately: approved postal footer IN-01, monitored public/reply address IN-02, existing consent/unsubscribe flow, and explicit email activation decision. | Update owner-input register and HANDOFF. Creating aliases never turns on the welcome sequence, broadcasts, SMS or live payments. |

### Address inventory to verify, not invent

The repository records this arrangement; actual Google Admin state still
requires Claude's read-back. Domain for every address is
`robinsonappliancerentals.com`.

| Address | Expected destination/type | Intended use |
|---|---|---|
| ops@ | Existing primary business mailbox | Internal inbox; preserve separation from Robinson AI Systems |
| chris@ | User alias to ops@ | Direct business correspondence |
| leads@ | User alias to ops@ | Website lead notifications |
| support@ | User alias to ops@ | Maintenance notifications; candidate public/reply address pending IN-02 |
| no-reply@ | User alias to ops@ | Existing application From identity through Resend; inspect Reply-To independently |
| billing@ | User alias to ops@ | Billing correspondence and configured billing notifications |

ARCHITECTURE contains historical wording that billing@ was reserved, alongside
a newer entry saying BILLING_NOTIFICATION_EMAIL is configured. Reconcile code,
deployed settings and Admin observations before updating that history. Do not
conclude billing is unimplemented from the old table row alone.

Do not create hello@, rentals@, info@, new staff users or Google Groups unless
a real approved need emerges. If multiple staff later need shared handling,
evaluate delegation/group/shared-inbox options and privacy first; record any
new paid seats as IN-15 and any access decisions as IN-13.

## Conditional integrations: only when their app phase is authorized

| ID | Work to document/setup through Workspace where supported | Boundary / evidence |
|---|---|---|
| GW-10 | Drive: select a business-owned folder for approved brand assets, contracts/templates and operating guides; inspect existing folders before adding any. Define owner and least-access sharing. | Folder IDs/permissions and an owner access check. No public customer documents, automatic customer-file uploads or code/secrets backups. Shared Drive availability must be verified, not assumed. |
| GW-11 | Calendar: select an existing business dispatch calendar or prepare one with approved sharing, America/Denver timezone and restrained customer details. | Record calendar ID and access. Appliance Desk stays authoritative; stable IDs, update/cancel behavior, retries and duplicate prevention must exist before enabling a one-way sync. Calendar creation alone is not a working sync. |
| GW-12 | Tasks: optionally mirror owner-input items into one specifically selected list. | Owner chooses whether this helps; preserve IN/GW IDs and avoid duplicate lists/tasks. Repo remains decision source of truth; no implication of autonomous monitoring. |
| GW-13 | Contacts: only if requested, define business-contact ownership, deduplication key, allowed fields and consent/privacy boundary before import/sync. | No broad personal address-book import or two-way sync by default. CRM remains customer record authority. |
| GW-14 | Operational ownership: record who monitors each inbox/calendar, who may administer them, and how access is handed off. Inspect existing account security/recovery posture where supported without collecting recovery secrets. | Owner confirms responsibilities; policy or recovery changes need a concrete reviewed proposal. No granting super-admin or tenant-wide privileges for convenience. |

Plugin availability is interactive access, not a background automation. Any
later scheduled Drive/Calendar/Gmail integration requires a separately scoped
service identity/authorization design, idempotency, audit/error visibility and
its own implementation card. Do not replace existing Resend delivery, CRM
message history or dispatch flows with an undocumented Google workflow.

## Order, model coordination and evidence

1. Claude performs GW-01/02 inventory first. It can happen while the Sol/Luna
   app batches proceed; no extra model switch in those batches is required.
2. Resolve only missing IN-02 decisions, then perform approved GW-03 through
   GW-07 configuration. Hand the exact settings contract to the app implementer.
3. GW-08/09 gate actual email activation. GW-10 through GW-14 are conditional
   work, not prerequisites for the basic CRM overhaul.
4. Every new app feature that depends on Workspace must add a GW task here:
   account/resource, proposed change, owner inputs, capability, verification,
   reversal plan and app task dependency. Do not leave setup solely in chat.
5. Record each task as NOT_STARTED, VERIFIED_EXISTING, READY, BLOCKED,
   APPLIED_UNVERIFIED, VERIFIED or DEFERRED with reason, date, agent,
   non-secret resource ID, before/after values, test evidence and next action.
   Initial state: all tasks NOT_STARTED; connection availability is owner-reported.
6. Put concrete Admin changes and observations in HANDOFF/ARCHITECTURE and
   decision answers in OWNER-INPUTS. Configuration evidence must distinguish
   proposed, applied and verified. Preserve other business configuration.
7. Code/docs changes follow PR-STACK.md and Claude review before merge. External
   Admin changes take effect independently of Git; a PR or git revert cannot
   undo them. Record the exact safe reversal for each applied change, preserving
   preexisting addresses, mail and access. Never delete existing mail to reset a test.

Claude's final handoff should list: completed GW IDs and evidence, remaining
owner inputs, unsupported/manual steps, exact non-secret app configuration
needed, anything still OFF, and whether email activation is ready for approval.
