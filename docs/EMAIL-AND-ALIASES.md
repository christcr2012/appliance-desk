# Email and aliases: guide, instructions and record

Robinson Appliance Rentals · domain `robinsonappliancerentals.com`
Last checked against Google Workspace: **2026-10-09** (through the Workspace connector; `privacy@` and `accounts@`
added the same day).

This is the one place that says which email addresses the business has, what each one is for, where it is used in the
app, and what is (and is not) set up. If this page and another doc disagree, check Google Workspace and then fix the
wrong one. Technical background lives in `docs/ARCHITECTURE.md` ("Email addresses (Google Workspace)") and the setup
register in `docs/plans/overhaul/CLAUDE-WORKSPACE-SETUP.md`; this page is the plain-English version plus the record.

## The short version

There is **one real mailbox**, `ops@robinsonappliancerentals.com`. Every other address is an **alias**: a second name for
the same inbox. Mail sent to any of them lands in the one `ops@` inbox, and the "To:" line (plus an automatic Gmail label)
tells you which name it came in on. Aliases cost nothing; only a real mailbox is a paid seat.

On 2026-10-09 every address the plans call for already existed. Two more, `privacy@` and `accounts@`, were added the
same day on Chris's approval because the build needs them (see "Recommended additions and why").

## The addresses

| Address | Type | Lands in | What it is for |
|---|---|---|---|
| `ops@` | The real mailbox (the one paid seat) | itself | The account of record. This is what Chris signs in to Gmail and the desk with. Never shown to customers. |
| `chris@` | Alias | ops@ inbox | Chris's own name on this business. Use when a person should write to Chris specifically. It is the **default "from"** when Chris writes a new email in Gmail. |
| `support@` | Alias | ops@ inbox (labeled **Support**) | The customer-facing address: replies, questions, maintenance requests. Receives the app's "new maintenance request" notices. The planned address for human replies from the customer record. |
| `leads@` | Alias | ops@ inbox (labeled **Leads**) | Receives the app's "new website lead" notices. Not for customers to write to; it is the app's internal drop box. |
| `billing@` | Alias | ops@ inbox (labeled **Billing**) | Billing correspondence, and receives the app's money notices (late-fee summaries, nightly backup notice, tax-rule watch). Chris can send from it. |
| `no-reply@` | Alias | ops@ inbox | The "from" name on automated emails the app sends (password resets, account activation). Replies to it land in the inbox, but nobody should be asked to write to it. |
| `dmarc@` | Alias | ops@ inbox | Receives the automatic reports other mail systems send about email claiming to be from this domain. Purely technical; check it only when tightening email security (see "Open items"). |
| `privacy@` | Alias (added 2026-10-09) | ops@ inbox (labeled **Privacy**) | Where people send privacy requests: "what data do you have on me", "delete it", "stop contacting me". Meant to be listed on the website's privacy page (not done yet, see "Open items"). |
| `accounts@` | Alias (added 2026-10-09) | ops@ inbox (labeled **Accounts**) | The sign-up address for the services behind the business (Stripe, Twilio, Vercel, Neon, Sentry, Resend, Metricool, Google Cloud). Their receipts, security alerts and compliance notices collect here, away from customer mail. |

## Where each one is used

| Address | Setting in the app | Code that uses it | Sends from it? |
|---|---|---|---|
| `no-reply@` | `RESEND_FROM_EMAIL` ("Appliance Desk <no-reply@…>") | `src/lib/email.ts` | Yes, **through Resend** (the app's own sender), not through Gmail |
| `leads@` | `LEAD_NOTIFICATION_EMAIL` | `src/domains/leads/index.ts` | No, receive only |
| `support@` | `MAINTENANCE_NOTIFICATION_EMAIL` | `src/domains/portal/index.ts` | Yes, Gmail "send as" (for human replies) |
| `billing@` | `BILLING_NOTIFICATION_EMAIL` | `src/domains/billing/late-fees.ts`, `src/domains/backup/index.ts`, `src/domains/tax/official-source-watch.ts` | Yes, Gmail "send as" |
| `chris@` | none | none (human use) | Yes, Gmail "send as" (default) |
| `ops@` | owner sign-in; later `GOOGLE_IMPERSONATE_USER` for the Google integration | planned `src/lib/google.ts` | Yes (primary) |
| `dmarc@` | none (named in the domain's DMARC record) | none | No |
| `privacy@` | none yet (the website's privacy page should name it) | none | No, receive only (add as send-as if replies should come from it) |
| `accounts@` | none (used when signing up for vendor services) | none | No, receive only |

The values above come from the repo's docs (`docs/ARCHITECTURE.md`, `.env.example`, `docs/DECISIONS.md`). The Vercel
environment variables themselves were **not** re-checked on 2026-10-09; confirm them in Vercel if anything seems off.

If one of the three notification variables is ever missing, the app falls back to the public email address saved in
**Desk → Settings** (`publicEmail`).

Two other addresses are chosen inside the desk, not in Vercel, and are still **waiting on Chris (IN-02)**:

- **Public email**, shown to customers on the website (Desk → Settings → `publicEmail`). Today it is Chris's own
  address. The plan's candidate is `support@`.
- **Reply-to email** (Desk → Launch → "reply email"). The desk requires one before it will let email be turned on.
  The candidate is also `support@`, so customer replies reach the business inbox.

## Receiving versus sending

- **Receiving** is Google Workspace. Every address above works for incoming mail today (MX records point to Google).
- **Automated mail the app sends** (lead notices, password resets, and so on) goes out through **Resend** on this same
  domain. Changing an alias in Google does not change how the app sends.
- **Mail Chris writes by hand** goes out through Gmail, and he can pick which name it is "from":

| Send-as name (display name) | Status |
|---|---|
| `ops@` ("Robinson Appliance Rentals") | Primary |
| `chris@` ("Chris Robinson") | Accepted, **default** |
| `support@` ("Robinson Appliance Rentals Support") | Accepted |
| `billing@` ("Robinson Appliance Rentals Billing") | Accepted |

All four carry the same Evergreen signature. `leads@`, `no-reply@` and `dmarc@` are deliberately **not** send-as names:
they only receive, or (for no-reply) are used by Resend. Add one only if a person really needs to reply from it.

## Inbox organization

Gmail applies a label automatically by the name the mail was sent to. Nothing is deleted, archived, forwarded outside
the company or marked read.

| Mail sent to | Label |
|---|---|
| `leads@` | Leads |
| `support@` | Support |
| `billing@` | Billing |
| `privacy@` | Privacy |
| `accounts@` | Accounts |

## How to use them day to day

- **Giving out an address:** customers get `support@` (or the public email once IN-02 is settled), and `privacy@` for
  privacy requests. Never hand out `ops@`, `leads@`, `no-reply@`, `dmarc@` or `accounts@`.
- **Signing up for a new service** (a payment, text-message, hosting or tracking account): use `accounts@`, so its mail
  lands in the Accounts label.
- **A privacy request arrives:** reply promptly and keep a note of what was asked and what you did. If it asks you to
  delete or hand over customer data, check with the desk's records rules before acting (nothing is deleted just
  because an email asked).
- **Replying to a customer:** reply from `support@` (pick it in the "From" menu in Gmail). For a money question, `billing@`.
  Use `chris@` only when it should come from Chris personally.
- **Reading the inbox:** open the Leads, Support or Billing label to see only that kind of mail.
- **A "no-reply" email got an answer:** it lands in the same inbox. Answer it from `support@`.

## Recommended additions and why

The original plan (`docs/plans/overhaul/CLAUDE-WORKSPACE-SETUP.md`) covers the first seven addresses in the table (ops@ through dmarc@) and says not to
create more "unless a real approved need emerges". On 2026-10-09 Claude reviewed what the app is building (customer
texting and calls, payments, tax tracking, marketing, the privacy page) and found these needs. Aliases are free; only a
real mailbox costs money.

**Added now (2026-10-09, approved by Chris)**

| Address | Why |
|---|---|
| `privacy@` | The website already has a privacy page and a consent flow, and customers can ask what is kept about them. That needs a real, monitored address to write to, and keeping it apart from `support@` stops those requests from getting buried among ordinary questions. |
| `accounts@` | The app depends on outside services (Stripe, Twilio, Vercel, Neon, Sentry, Resend, Metricool, Google Cloud). Their receipts, security alerts and compliance notices should not mix with customer mail. Twilio's business-texting approval (A2P) and the telecom account (IN-51) also need a stable contact address. Using one alias means the contact can be re-pointed later without changing every service. |

**Add later, when the need is real (not created)**

| Address | When and why |
|---|---|
| `hello@` (or `news@`) | Only when welcome emails or broadcasts are turned on. Marketing mail should come from a different name than password resets, so a marketing complaint cannot hurt delivery of the important mail. The plan says not to create it earlier, and that still holds. |
| `abuse@`, `postmaster@` | Standard addresses mail systems use to report problems with a domain. Free and low priority; add them when email goes live. |

**Not needed (do not create)**

`sales@`, `service@`, `dispatch@`, `info@`, `rentals@`: `support@` already covers customers, and more names only
mean more places to check. No extra staff mailbox, and no Google Group, unless staff truly need to share mail. If that
happens, look at delegation, a group or a shared inbox first, and record any new paid seat in OWNER-INPUTS as IN-15 and
any access decision as IN-13.

**Testing without a test address:** Gmail treats `ops+anything@robinsonappliancerentals.com` as `ops@`, so mail to
`ops+test@…` arrives in the same inbox with no setup. Use that for the GW-08 mail test instead of creating an alias.

## Open items (nothing here blocks the rest of the work)

1. **IN-02, owner decision:** confirm the public email and the reply-to email (candidate: `support@` for both), and
   confirm customer replies actually reach the inbox.
2. **DMARC tightening:** the domain's DMARC policy is `p=none` (reports only, nothing blocked). If the reports at
   `dmarc@` show only the business's own legitimate mail passing, change it to `p=quarantine` **on or after
   2026-10-24**, then `p=reject` **on or after 2026-11-23**.
3. **End-to-end mail test (GW-08):** not run. It needs Chris's explicit go-ahead and an approved test inbox.
4. **Email activation:** the desk's own on/off switch for customer email is a separate decision. Aliases being in place
   does not turn on email, texts or payments.
5. **Put `privacy@` on the website's privacy page:** the alias exists but the page does not name it yet. That is an
   app change and needs its own approved card; changing the privacy text also needs a new version and Chris's usual
   review. Until then, `privacy@` receives mail only from people who know it.
6. **Move existing vendor accounts to `accounts@` (optional):** accounts already created keep whatever email they were
   opened with. Switch each one inside that service when convenient. New sign-ups should use `accounts@` from now on.
7. **Old wording to reconcile:** `docs/ARCHITECTURE.md` still says `billing@` is "reserved, not used by any code yet",
   but the same page and the code show `BILLING_NOTIFICATION_EMAIL` is in use. This guide reflects the code.

## Good to know

- The business domain is a **second domain inside the same Google Workspace account** as Robinson AI Systems. The
  mailbox is its own separate user in its own folder (`/Robinson Appliance Rentals LLC`), so mail and settings are not
  mixed, but the two businesses share one Google account. Do not change anything for the other business from here.
- Anything in this guide that Google controls (aliases, send-as, labels) takes effect independently of Git. Changing
  this file does not change Google, and undoing a commit does not undo a Google change.

## How to change something

**Add an alias:** Google Admin → Users → ops@ → Add alternate email (or ask Claude to add it through the Workspace
connector). Check first that the name is not already used by another user or group. Then add it to the table above.

**Let Chris send from an alias:** Gmail → Settings → Accounts → "Send mail as" → add it (Claude can also do this through
the connector). Add it to the send-as table above once Gmail shows it as accepted.

**Remove an alias safely:** only on Chris's say-so. Mail sent to a removed alias is lost to the sender, so first change
the setting that uses it (see "Where each one is used") and wait. Never delete the mailbox to "reset" a test.

**Point the app at a different address:** change the matching environment variable in Vercel (or the setting in Desk),
then update both tables above in the same change.

## Record (newest first)

| Date | What | Who | Evidence |
|---|---|---|---|
| 2026-10-09 | Added aliases `privacy@` and `accounts@` to ops@, plus Gmail labels **Privacy** and **Accounts** and one filter each (by the name the mail was sent to; no auto-delete, archive or forwarding). Not added as send-as. **Reversal:** delete the two filters and labels in Gmail, then remove the aliases from ops@ in Google Admin; no mail is lost, since it all sits in the one inbox. | Claude, approved by Chris | Read-back: both aliases listed on ops@; both filters listed with their labels |
| 2026-10-09 | Read-only audit of users, aliases, groups, send-as, filters, labels and mail-security records. All six plan addresses plus `dmarc@` present, no groups, no extra users, no collisions. **No changes made.** | Claude | Workspace connector read-back; email-health check: 6 pass, 2 warn (DMARC policy not yet enforced; `leads@`, `no-reply@`, `dmarc@` are receive-only by design) |
| 2026-09-30 | Send-as names for chris@, support@, billing@, ops@ with signature; Leads/Support/Billing labels and filters; DMARC record `p=none` added | Chris with Claude | `docs/plans/google-workspace-integration/README.md` |
| 2026-09-28 | App wired to leads@, support@, no-reply@ (Task #69) and billing@ (Task #72) | Claude | `docs/DECISIONS.md` |
| 2026-09-27 | Mailbox `ops@` created with aliases chris@, leads@, support@, no-reply@, billing@ | Chris with Claude | `docs/ARCHITECTURE.md` |
