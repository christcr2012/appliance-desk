# Appliance Desk testing environment

Owner-approved October 24, 2026. Chris confirmed there has never been real production data and specifically
directed resetting and seeding the **existing preview database**. This is ongoing project infrastructure.

| Concern | Public business app | Dedicated testing app |
|---|---|---|
| Vercel project | `appliance-desk` | `appliance-desk-testing` |
| Canonical URL | https://robinsonappliancerentals.com | https://appliance-desk-testing.vercel.app |
| Git branch | `live` | `testing` |
| Database | Existing production database | Existing `vercel-preview-2`, database `appliance_desk` |
| Database role | Existing production credential | Independent `appliance_desk_testing` role |
| App environment | Business production | `APP_ENV=testing`, even on Vercel's Production target |
| Build command | `npm run vercel-build` | `npm run vercel-build:testing` |
| Fixtures | Never seed/reset | `npm run db:seed:testing`, guarded and additive |
| Stripe | Existing setup; LIVE still requires owner approval | Official connector's existing Test mode; separate webhook destination |
| File storage | Existing stores | Dedicated private `appliance-desk-testing-private` store |
| Emails, SMS, scheduled business jobs | Existing owner switches | Refused by code; no customer-provider credentials configured |

## Credentials and access

Store all values directly in the testing Vercel project's environment-variable editor. Never put a key or
password in chat, documentation, source control, screenshots or logs. Database and authentication credentials
are independent of the public app. Public self-signup remains disabled and normal role/MFA rules still apply.
The seeded owner is `owner@example.test`; it must enroll its own authenticator through the normal setup flow.
The no-login fixture system identity is not an agent login.

Required configuration: `APP_ENV=testing`, `TEST_DATA_SEED=synthetic-only`, `TEST_DATABASE_HOST` (independently
verified direct preview hostname), `TEST_VERCEL_PROJECT_ID` (this testing project), `DATABASE_URL` and
`DIRECT_URL` (the preview endpoint and dedicated role), an independent `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` (canonical testing URL), `TEST_PRIVATE_BLOB_STORE_ID`, and the
private store's auto-injected `BLOB_READ_WRITE_TOKEN`. Do not copy production database/storage/auth values.

`TEST_OWNER_PASSWORD` is chosen privately by Chris (16+ characters); the seed creates the owner only if this
variable is supplied and the account does not exist. Repeated builds never rotate an existing password.
`STRIPE_SECRET_KEY` must be an `sk_test_` or correctly scoped `rk_test_` key from the exact account selected in
the official Stripe connector. `STRIPE_WEBHOOK_SECRET` belongs only to the testing endpoint
`https://appliance-desk-testing.vercel.app/api/webhooks/stripe`. Never copy the business site's signing secret.
Vercel Authentication protects preview deployment URLs; the canonical testing deployment uses the app's
normal authenticated roles so Stripe can reach its signature-protected callback.

## Seed contents and repeatability

The guarded seed adds three fictional customers/addresses, a washer and dryer, ten units of a clearly labeled
$1 checkout part with its stock movement, and a fictional zero-rate shop/delivery jurisdiction. Tax rows and
simulated confirmation dates are **test fixtures**, not real rates or professional approval. The persistent
testing banner labels every screen. Search indexing is disallowed. No production users, hashes or MFA secrets
are copied, and test rows are never exported to production.

The seed requires the application marker, explicit seed opt-in, verified host, dedicated role, expected
database name and matching Vercel project. It runs before the first query and before migration connections.
It refuses live Stripe keys and alternate connection targets. Repeated builds only add missing fixture rows;
they preserve completed sales/refunds, changed stock, test settings and existing accounts. A deliberate reset
requires explicit owner approval and verification of the provider branch and endpoint first.

## Deploy, verify and release

PRs still target `main`; normal CI runs on throwaway Postgres and never on this hosted database. On successful
main-push CI, the dedicated workflow rechecks exact-head trusted `ci`/`release-policy` results, then atomically
fast-forwards `testing` once per Denver day. Vercel migrates this database, checks schema health, seeds missing
fixtures and builds. The public project's daily checked `main` to `live` promotion is unchanged.

Before hosted acceptance, verify the testing domain resolves to a READY deployment of the intended SHA,
the testing banner appears, fixture rows are present, messaging/cron refusals hold, and Stripe identity is the
intended account in Test mode. Test a sale from the app: create a $1 pickup sale, use Pay by card, complete hosted
Checkout with Stripe test details, verify Paid exactly once after a genuine signed update, then refund the
same payment and verify the result in both systems. A Stripe-only payment is not proof of the app flow.

Going live means releasing tested code/migrations and configuring real business settings/credentials in the
business app. It never means switching the public site back and forth between databases or copying test data.
Check [OWNER-CHECKLIST.md](OWNER-CHECKLIST.md) for credentials/provider acceptance still awaiting real evidence.
