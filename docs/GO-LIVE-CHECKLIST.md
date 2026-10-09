# Go-live checklist — everything that must be switched on for real customers

Written for Chris (not a developer). Rule of the project: **everything is built and working in the code as we go.**
Anything that touches real money, real customers or real accounts is *off* in previews and test copies by itself
and only becomes live in production when you complete the step listed here. Nothing below is turned on for you.
Each line says what it is, where it gets switched on, and what state it is in today. Tick a box only after the
"how you know it worked" check is done. Keep this file current: every PR that adds a switch adds a line here.

Legend: **Owner** = only Chris can do it · **Agent** = Claude can do it once you say go.

## 1. Money (Stripe)
| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Stripe account verified for live payments (business details, bank account) | Stripe dashboard (Owner) | Test mode only | Stripe shows "Live payments enabled" |
| [ ] | Live secret key put in production | Vercel → Environment Variables → `STRIPE_SECRET_KEY` (Production only) (Owner) | Test key | Pay a real $1 test invoice, then refund it |
| [ ] | Live webhook registered at `<your site>/api/webhooks/stripe` and its signing secret saved | Stripe dashboard, then Vercel `STRIPE_WEBHOOK_SECRET` (Owner) | Test webhook | A real payment shows as paid in the desk within a minute |
| [ ] | Sales tax rate confirmed with your CPA (7.375% starting value, IN-17) | Desk → Settings → tax, then tick "confirmed" (Owner) | Not confirmed | Settings shows the rate as confirmed |
| [ ] | Prices, deposit, late fees, prepay discounts reviewed | Desk → Settings (Owner) | Starting values | You have read every number on the settings screens |
| [ ] | Held-payment and refund rules understood | Desk → Billing → Held payments (Owner) | Built | Walkthrough done |
| [ ] | Pickup and delivery billing rules reviewed (late-return rate, late-delivery credit basis, pickup day not charged) | Desk → Settings → Pickups and deliveries (Owner) | Recommended values | You have read the three rules and saved them |
| [ ] | Early-return choices reviewed: keep billing or stop at pickup, unused days (keep/credit/refund), early-ending fee, ask me or apply automatically (IN-29) | Desk → Settings → Ending and renewing rentals (Owner; built by Batch B2 #208) | Ask me each time | You have read each choice and saved your defaults |

## 2. Customer email
| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Email service account and your sending domain verified | Resend dashboard + DNS (Owner/Agent) | Not live | Resend shows the domain "verified" |
| [ ] | Email key put in production | Vercel `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (Production only) (Owner) | No key = nothing sends | A test email arrives from your own address |
| [ ] | Owner switch "Send emails to customers" turned On | Desk → Settings → Notifications (owner only; built, starts Off) | Off | Renewal reminders on Desk → Notices turn "sent" (nightly), or send one by turning it on then waiting for the next night |
| [ ] | Launch-list emails | Desk → Launch controls (has its own approval, separate from the switch above) (Owner) | Off | |
| [ ] | Where staff alerts go | Vercel `BILLING_NOTIFICATION_EMAIL`, `LEAD_NOTIFICATION_EMAIL`, `MAINTENANCE_NOTIFICATION_EMAIL` (Owner) | Not set | Test lead/billing alert arrives |
| [ ] | **Owner switch "Automatic renewals" stays OFF until B2 is confirmed merged and counsel/owner wording gates (IN-21, IN-31) are satisfied** | Desk → Settings → Ending and renewing rentals (owner only; built, starts OFF) | Off | Batch B2 #205–#208 is merged. Before turning this on, complete the attorney/wording checks below and perform the live walkthrough; while OFF no automatic renewal extends billing. |
| [ ] | Customer "Turn off automatic renewal" button tried end to end on the live site | My rentals page (customer account) | Built | Use a test customer with auto-renew on |
| [ ] | Wording of every customer message read and approved | Notices, billing reminders, launch emails (Owner) | Draft wording | You approve each |

Previews and test copies never send email, even with the key and the switch on (a safety rule in the code). The switch covers every email to a customer (renewal reminders, payment heads-up, estimates and follow-ups, referral credits); staff alerts and sign-in/password emails are not affected.

## 3. Text messages (SMS)
| [ ] | Twilio account, number and registration for business texting | Twilio dashboard (Owner) | Not live | |
| [ ] | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in production | Vercel (Owner) | Not set | Test text arrives |
| [ ] | Customer text consent wording approved | Owner + attorney | Not decided | |

## 4. Legal wording and rental terms
| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Colorado attorney reads the early-ending and auto-renew wording and the rental agreement | Desk → Settings → Terms (Owner) | Recommended starting wording | Attorney sign-off saved in `docs/OWNER-INPUTS.md` |
| [ ] | Privacy policy, terms of use, accessibility statement published | Website pages (Owner approves) | Drafts | |
| [ ] | Month-to-month notice wording approved (IN-21) | Owner + attorney; mechanism is already built in B2 #207 | Starting draft, live email OFF | Approval recorded before any live notice email is enabled |
| [ ] | Is the early-ending fee taxable (IN-25) | CPA | Not taxed | |
| [ ] | Pickup/return billing rule walkthrough: stop at pickup, waive company-caused delay (IN-24) | Built in Batch B2 #208 | Built, not yet live-proven | Record "our delay" on a late test pickup; the late charge and matching waiver net correctly |

## 5. Website and company information
| [ ] | Real business name, phone, email, address, hours, service area | Desk → Settings (Owner) | Placeholders like "[Phone Number]" until entered | Public site shows real details |
| [x] | Custom Robinson Appliance Rentals domain bought and pointed at the site | Vercel + domain registrar | Live | Production site opens on the custom domain over HTTPS |
| [ ] | `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` set to the real domain | Vercel (Production) | Test address | Login and emailed links go to your domain |

## 6. Accounts, security and platform
| [ ] | Your owner login created and tested; test/seed accounts removed from production | Agent with your OK (never on the live database without your say) | Pending | Only real people can log in |
| [ ] | `BETTER_AUTH_SECRET` and `CRON_SECRET` are long random values unique to production | Vercel (Production) (Owner/Agent) | Set | Nightly jobs run (Desk shows no errors) |
| [ ] | Nightly jobs are running (Vercel Cron: reminders, renewals, late fees, billing check, backup, follow-ups) | Vercel → Cron (Owner checks) | Scheduled | Run history shows green daily |
| [ ] | Daily backup tested by restoring it into a throwaway copy | Agent (Batch F) | Backups run | Restore proof recorded |
| [x] | Neon plan upgrade and production branch protection | Neon | Completed/verified 2026-09-29 | Production `main` is protected; normal previews already use the isolated preview branch |
| [x] | Preview database isolated from production | Existing `vercel-preview-2` guard/proof | Verified | One fresh Neon branch per individual preview remains optional post-launch hardening, not a launch gate |
| [ ] | Photo storage (private) set for production | Vercel Blob tokens (`PRIVATE_PHOTO_BLOB_*`, `BLOB_READ_WRITE_TOKEN`) | Set per environment | Photo upload works in production only |
| [ ] | Public sign-up stays disabled | Already enforced in code | Disabled | Nothing to do |

| [ ] | Decide your standard "When equipment comes back early" choices (Settings → Ending and renewing rentals) and whether to apply them automatically | Chris (Owner) | Ask me each time | Today shows "Returned early" items after a test pickup |
| [ ] | Counsel confirms the month-to-month wording, the yearly reminder and what counts as delivering a notice (IN-31) | Chris + attorney | Deferred | Written approval before automatic renewals or live customer email are turned on |

## 6b. Coming with the proposed batches (2026-10-06 — these lines become real when each batch is built)

- [ ] **Sales tax (Batch T):** CPA has answered IN-17 and IN-33 … IN-38; the answers are entered in Desk → Money → Sales
      tax and every rule in use shows "CPA confirmed"; Colorado license number entered as a filing account (plus a City
      of Greeley one only if Greeley issued a separate account — Greeley files through SUTS); every tax area you serve
      has its rate and start date. Until this is done, **do not bill real customers**.
- [ ] **Tax filing prompts (Batch T Amendment A) — recommended, not a launch blocker (tick or mark "skipped — after launch"):** each filing account has its frequency, first period and license
      expiry; the SUTS codes and order match your SUTS return (IN-43); the deduction names are filled in from your
      CPA's answer (IN-44); you received one test reminder email and downloaded the calendar file to your phone; the retail
      delivery fee status in the app is confirmed by your CPA (IN-37), and if it applies, this year's fee amount is entered;
      the official-sources list shows every page checked successfully at least once.
- [ ] **System health and AI check-up (Batch S):** System health shows no unexplained high issues; optional: AI
      check-up key created, stored in your Claude environment, and the morning routine created (IN-45).
- [ ] **Two-step login (Batch G):** you and every admin have enrolled; backup codes stored away from your phone.
- [ ] **Website look (Batch V):** you have accepted the redesigned public site and checked the editable home-page text.
- [ ] **Books (Batch K, can be after launch):** books start date set; accounts mapped to your accounting software; one
      month imported into a trial company and it balanced.

## 7. Final launch day (in this order)
1. Every box above is ticked or has an explicit "skip for now" you chose.
2. Full automated checks green on the exact version going live; Batch F verification report read by you.
3. A real $1 payment, refund, renewal reminder and a customer login tested end to end.
4. You say, in writing, "launch". Only then do the live keys and the email switch go on.

## Batch E messaging provider registration

- [ ] Register the production Resend webhook URL: `/api/webhooks/resend`.
- [ ] Set and verify `RESEND_WEBHOOK_SECRET` in the production environment.
- [ ] Register the production Twilio status/inbound webhook URL: `/api/webhooks/twilio`.
- [ ] Confirm Twilio signs the exact production URL with the configured `TWILIO_AUTH_TOKEN`.
- [ ] Send test provider events and verify forged/unsigned requests are rejected and real events appear once.
- [ ] Verify STOP clears SMS opt-in, records consent evidence and suppression.
- [ ] Verify a hard bounce suppresses the address and customer/lead **Messages** panels show honest states.
- [ ] Review `docs/runbooks/PROVIDER-OUTAGE.md` before enabling live messaging.
- [ ] **Do not enable customer email, SMS or marketing merely because webhook credentials are present.** Existing owner activation/approval gates still apply.

## Proposed business offers and partnerships — not built or enabled

These are conditional release checks for Batch BP, not new blockers for unrelated approved engineering work.

- [ ] Before publishing a BP offer: IN-48 final prices, minimum-term/fee disclosures, eligible stock and real service capacity reviewed; preview agrees with quote, signing and invoice.
- [ ] Before new permission/master templates: IN-49 counsel review and exact template-version approval; lawful-access procedure understood; signature and installation gates demonstrated.
- [ ] Before partner commissions: IN-50 signed policy, disclosures and margin approved; settled-rent/reversal tests and owner manual-payment walkthrough passed; no automatic transfers enabled.
- [ ] Before relying on acquisition-tax exemption: resolve IN-33's unpaid-use-tax question and IN-36 continuity treatment as applicable; the consultant's document is not approval evidence.


## Approved COM communications subsystem — not yet built or activated

Design `docs/designs/BATCH-COM.md`; setup `docs/runbooks/COMMUNICATIONS-TWILIO.md`. Engineering and live approval are separate.

- [x] Design/order approved by Chris 2026-10-08. Selected launch-scope implementation and COM-L/F evidence still remain before activation.
- [ ] IN-03/09/51: verify account/permanent Voice+SMS number, entity/EIN/campaign/consent; explicit purchase/port/A2P/provider edit/live-send/publication approvals where applicable.
- [ ] Production+owner SMS/voice activation fences verified; preview/local/tests never use production account/number or contaminate costs.
- [ ] Canonical signed inbound/status/voice URLs, account/number checks, Advanced Opt-Out, callback replay, UNKNOWN holding and tested provider outage fallback.
- [ ] IN-52: voicemail/privacy/retention policy approved if selected; ordinary recordings/transcription independently OFF.
- [ ] IN-53: budget/destination/feature/alert rules accepted; Today/S and independent alert path proven.
- [ ] Monthly provider usage vs estimate vs verified invoice distinct; stale/unknown/unallocated costs visible; no K posting until statement/payment verified.
- [ ] Controlled production proof only consenting owner phones after explicit live approval; activate workflows separately; no automatic public number replacement.

## Post-launch K-CASH activation — not a rental-launch gate

- [ ] IN-54: selected bank/QBO actual journal import/feed or CSV/matching/zero-difference statement verified.
- [ ] IN-55: opening composition/liabilities/card debt/legal reserve treatment/actual costs and targets confirmed.
- [ ] Source/money/privacy/restore/UI proofs pass; latest bank evidence verified; virtual envelopes, forecast-only
  income and stale/unknown limitations understood; no automatic payments.
- [ ] Real period imported/matched without duplicate posting; accounting delivery confirmation saved.
- [ ] Paid/API/bank-transfer/live Stripe changes retain separate explicit approval.

### Batch T workspace engineering proof (not production activation)

The six-section Sales tax workspace, guided owner filing screens and Today
attention are an engineering implementation; they do **not** tick the
live Colorado tax signoff. Verify IN-17 and IN-33–IN-38 with a CPA, the
actual address-accurate authenticated GIS procedure, filing account details,
actual live provider credentials and official return/payment evidence.
IN-43/44 only affect packet wording. Do not equate test-only PostgreSQL,
fixture uploads or previews with a production GIS, government filing or
payment smoke test.
