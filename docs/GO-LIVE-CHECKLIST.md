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

## 2. Customer email
| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Email service account and your sending domain verified | Resend dashboard + DNS (Owner/Agent) | Not live | Resend shows the domain "verified" |
| [ ] | Email key put in production | Vercel `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (Production only) (Owner) | No key = nothing sends | A test email arrives from your own address |
| [ ] | Owner switch "Send emails to customers" turned On | Desk → Settings → Notifications (owner only; built, starts Off) | Off | Renewal reminders on Desk → Notices turn "sent" (nightly), or send one by turning it on then waiting for the next night |
| [ ] | Launch-list emails | Desk → Launch controls (has its own approval, separate from the switch above) (Owner) | Off | |
| [ ] | Where staff alerts go | Vercel `BILLING_NOTIFICATION_EMAIL`, `LEAD_NOTIFICATION_EMAIL`, `MAINTENANCE_NOTIFICATION_EMAIL` (Owner) | Not set | Test lead/billing alert arrives |
| [ ] | **DO NOT fill in the automatic-renewal wording and notice days (Settings → Ending and renewing rentals) until the renewal-lifecycle design amendment is built** | Settings (Owner) | Left blank = automatic renewal stays off | Open findings R1-R4, D1-D2 in `docs/reviews/2026-10-03-pr161-independent-review.md`: billing updates can overlap, the customer loses the cancel button after the first renewal, annual reminders stop, manual-delivery evidence rule. Prompt: `docs/prompts/DESIGN-BATCH-B-RENEWAL-LIFECYCLE.md` |
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
| [ ] | Month-to-month rules and 30-day change notice decided (IN-21) | Owner decision, then Agent builds | Waiting for you | |
| [ ] | Is the early-ending fee taxable (IN-25) | CPA | Not taxed | |
| [ ] | Pickup/return billing rule: stop at pickup, waive company-caused delay (IN-24) | Batch C | Requirement recorded, not built | |

## 5. Website and company information
| [ ] | Real business name, phone, email, address, hours, service area | Desk → Settings (Owner) | Placeholders like "[Phone Number]" until entered | Public site shows real details |
| [ ] | Your own domain bought and pointed at the site | Vercel + domain registrar (Owner approves spending) | Not bought | Site opens on your domain with a lock icon |
| [ ] | `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` set to the real domain | Vercel (Production) | Test address | Login and emailed links go to your domain |

## 6. Accounts, security and platform
| [ ] | Your owner login created and tested; test/seed accounts removed from production | Agent with your OK (never on the live database without your say) | Pending | Only real people can log in |
| [ ] | `BETTER_AUTH_SECRET` and `CRON_SECRET` are long random values unique to production | Vercel (Production) (Owner/Agent) | Set | Nightly jobs run (Desk shows no errors) |
| [ ] | Nightly jobs are running (Vercel Cron: reminders, renewals, late fees, billing check, backup, follow-ups) | Vercel → Cron (Owner checks) | Scheduled | Run history shows green daily |
| [ ] | Daily backup tested by restoring it into a throwaway copy | Agent (Batch F) | Backups run | Restore proof recorded |
| [ ] | Database plan upgrade (protected branches, per-preview databases) | Neon (Owner approves spending) | Not upgraded | |
| [ ] | Photo storage (private) set for production | Vercel Blob tokens (`PRIVATE_PHOTO_BLOB_*`, `BLOB_READ_WRITE_TOKEN`) | Set per environment | Photo upload works in production only |
| [ ] | Public sign-up stays disabled | Already enforced in code | Disabled | Nothing to do |

## 7. Final launch day (in this order)
1. Every box above is ticked or has an explicit "skip for now" you chose.
2. Full automated checks green on the exact version going live; Batch F verification report read by you.
3. A real $1 payment, refund, renewal reminder and a customer login tested end to end.
4. You say, in writing, "launch". Only then do the live keys and the email switch go on.
