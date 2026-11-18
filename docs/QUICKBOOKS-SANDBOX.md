# QuickBooks (Intuit) — sandbox setup for Appliance Desk

Read this before doing any QuickBooks work in this repo. The setup below is
**done and verified** (2026-11-17) — do not recreate the app, and do not ask
Chris for keys.

## What exists

- **Intuit developer app:** "Appliance Desk" in Chris's Intuit developer
  account (developer.intuit.com; the workspace/team is named
  **Robinson AI Systems**). QuickBooks Online, scope
  `com.intuit.quickbooks.accounting`, status IN DEVELOPMENT.
- **Sandbox keys (the only keys that exist):**
  - Proton Pass, vault **"Server Secrets — Agent"**, item
    **"Appliance Desk — Intuit app keys"**.
  - Client ID: 50 characters, sha256 fingerprint (first 12) `b1c6276d317b`.
  - Client Secret: 40 characters, sha256 fingerprint (first 12) `2c8000009463`.
  - The same pair is placed as environment variables in the Vercel project
    **appliance-desk-testing** (only there): `QBO_CLIENT_ID`,
    `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT=sandbox`.
  - The production project's settings hold **no** `QBO_*` variables.
- **Production keys do not exist.** Intuit's app-details and compliance steps
  were never started. Never write or say that production QuickBooks works.
- **Redirect URI registered on the app:**
  `https://appliance-desk-testing.vercel.app/api/quickbooks/callback`
  The connect flow must use exactly this address. If the callback path ever
  changes, update the app in the Intuit portal first, then this file.
- **Endpoints (sandbox):**
  - Authorize: `https://appcenter.intuit.com/connect/oauth2`
  - Token: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
  - API base: `https://sandbox-quickbooks.api.intuit.com`
  - Discovery (sandbox):
    `https://developer.api.intuit.com/.well-known/openid_sandbox_configuration`
- **Sandbox companies:** Intuit provides throwaway sandbox companies under
  the developer account. In sandbox mode, connect the testing app to a
  sandbox company only — never a real QuickBooks company.

## State of the integration

There is **no QuickBooks code in this repo yet** — no connect route, no
token storage, no sync. The app, the sandbox keys, the settings and this
document are the setup; building the integration is its own card. When you
build it:

- Run the OAuth flow server-side; store the realm ID and refresh token as
  sealed settings (never in code, never in this repo).
- Mirror the environment split above: sandbox keys in the testing project
  only, until Chris approves a production step.
- Cleaning Desk (a separate Robinson AI Systems product) already runs this
  exact pattern end to end against the sandbox — its setup is the worked
  example, but its app and keys are **its own** (see the rules).

## Rules

- **One Intuit app per product** (Chris's standing rule, the same as his
  Stripe rule). Never borrow Cleaning Desk's or YardSync's app or keys, and
  never lend this app to another product.
- **Keys never appear in chat, PRs, commits, issues or logs.** Refer to
  them by Proton item name and fingerprint only. If a key value ever lands
  in the open, treat it as burned: tell Chris, rotate it in the Intuit
  portal, and re-file it in Proton and the settings in the same pass.
- **Sandbox only** until Chris explicitly approves production. Production
  keys are a separate Intuit compliance process and a separate owner
  decision.
