# Hosted preview isolation evidence — 2026-10-01

Status: hosted database and application private-file isolation checks passed;
original store restricted to Production, all owned fixtures removed. The O02
infrastructure prerequisite is cleared for O09/O10. Final integrated batch gate G
remains pending; no separate proof PR or full-CI rerun.

## Latest execution checkpoint

Owner explicitly approved restricting the original photo-store connection and
deleting the two owned fixtures. Saved and verified its connection now lists
Production only, preserving BLOB_READ_WRITE_TOKEN for Production. No token
rotation, production file deletion, plan change or live activation performed.
Previously deployed previews retain their old deployment environment until
redeployed; their existing photo/backup guards remain closed.

Removed LaunchSubscriber cmupulz97000004k1pnkmu08i using all three exact
id/email/name predicates plus a no-deliveries condition on the preview branch.
Exactly one id returned; subsequent read returned remaining=0. Removed only
the exact 106-byte UUID file through the private-store dashboard. Its file
list is empty after deletion; no other store or file was deleted.

Implemented owner-only /desk/settings/preview-storage for the final runtime
check. Available only on Vercel Preview with the verified private store id
and matching explicitly named credential; refuses missing/wrong credentials
without falling back to production. Server generates one UUID pathname and
synthetic contents, writes privately, verifies exact read contents, requests
the unsigned URL with no authorization and requires provider 403, then deletes
only its own pathname and verifies absence. Cleanup failures disclose only
the pathname, never provider errors/tokens, and disable repeat submission in
the current form. No schema change or activation of preview photo/backup APIs.

41 focused storage/database guard tests passed; targeted lint/typecheck passed.
After the cleanup-feedback correction, all 18 storage tests and targeted lint
passed again. No full suite/CI rerun. Publish a branch checkpoint for the
necessary hosted runtime proof, not a separate PR; keep O09/O10/O11 in this
same batch. Hosted execution subsequently passed as recorded below.

## Hosted application private-file proof — passed

Deployment dpl_D96CFwsEVairFmWdwrxP1LYmb6qd reached READY at remote head
57255a0cd3f7b9fbd22cfab2f9cfcdb587c1ff4a on
ai/codex/roadmap-foundation-and-tasks. Only the six proof implementation/test/doc
files were published at this checkpoint, based directly on remote main; local
recovered snapshot ancestry was not pushed. No PR or full CI was started.

Owner signed in through the secure browser-auth form to the existing preview
OWNER account. Executed /desk/settings/preview-storage through the actual hosted
application. Its rendered result confirmed: private write and exact-content read
passed, tokenless access was refused, and the test file was removed. Generated
owned path: preview-checks/7321caae-efbf-456a-89c0-04666953104d.txt.
The implementation requires unsigned HTTP 403 and verifies get returns null after
cleanup before reporting success. The result screenshot was saved and inspected.
No production credential fallback, real customer content, payment or message.

Together with the earlier database branch write/absence proof and independent
private store identity, this clears the infrastructure prerequisite for task
schema work. Preview photo/backup APIs remain disabled; enabling them is not
claimed by this diagnostic. O02 final integrated batch acceptance remains pending.

## Hosted database write

Used the real public launch form on the fleet preview deployment
`dpl_E3RebSExj3cWhF1DA14U3YgEYSzi`, source
`abe3f800b9a413d1db2816ece92a757416300407`. The app reported successful signup.
Synthetic fixture UUID: `cd9441a2-fcb3-4cf7-9125-07545357bbed`.
Email: `preview-isolation-cd9441a2-fcb3-4cf7-9125-07545357bbed@example.com`.
No real customer information, payments or messages were used.

Narrow read-only queries against database `appliance_desk`, project
`jolly-term-08991992`, using that exact email:

| Target | Result |
| --- | --- |
| Preview `br-broad-union-b784qy62` | One LaunchSubscriber, `cmupulz97000004k1pnkmu08i`, nextStep 0 |
| Production `br-wild-smoke-b7etke32` | No rows |

Existing build/runtime URL allowlists and migration/upgrade evidence remain
applicable. The hosted write proves runtime isolation, rather than inferring
it from a READY build. The subscriber was subsequently removed with explicit
owner approval (see latest checkpoint). Preview message suppression remains enabled.

## Independent private file store

Owner authorized dashboard fallback, then explicitly authorized creating the
preview read/write credential at the final connection step.

- New store: `appliance-desk-preview-private`,
  `store_6Sttks2ULJ8wG5hl`, private, IAD1.
- Connected only to `appliance-desk` / Preview, sensitive credential enabled.
- Prefix: `PREVIEW_PRIVATE_BLOB`; variables are
  `PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN`, `PREVIEW_PRIVATE_BLOB_STORE_ID`,
  `PREVIEW_PRIVATE_BLOB_WEBHOOK_PUBLIC_KEY`.
- Existing included usage: $9.29 consumed of $20.00 at inspection. No plan
  upgrade or paid add-on purchased. A tiny test uses existing included credit.
- Uploaded the owned 106-byte synthetic text file
  `preview-isolation-cd9441a2-fcb3-4cf7-9125-07545357bbed.txt` through Vercel's
  supported dashboard upload. Authenticated dashboard read showed its exact
  UUID and synthetic-only contents.
- A direct HTTP request to the private Blob URL without a token, signature,
  cookie or authorization header returned 403 Forbidden. Response included
  `Server: Vercel` and `X-Vercel-Id`; this is provider denial, not an inferred
  browser/network error.
- The production store `appliance-desk-photos`,
  `store_KPHIdNdaYTgGP2v5`, returned no file for the exact owned prefix.

Limitations: dashboard download stalled; no downloaded-file comparison is
claimed. Browser direct navigation was client-blocked and is not anonymous
denial evidence. The authenticated dashboard read and independent HTTP 403
are the evidence. Do not save or publish dashboard-generated delegated URLs;
they contain temporary access signatures. At that earlier provider checkpoint,
application runtime proof was still pending; the new deployment and hosted check
above subsequently passed. Older deployments predate the connection and require
a new deployment to receive its variables. Photo-token and backup guards remain closed.

## Earlier blocked connection checkpoint — resolved by owner approval above

At this earlier checkpoint the original public production store was connected to Production,
Preview and Development using `BLOB_READ_WRITE_TOKEN`. Prepared its supported
Update Project Connection dialog to restrict it to Production. Automatic
approval review rejected submission because removing Preview/Development
access could disrupt those environments and the owner had authorized only
the new-store connection. No scope change was applied; do not bypass this
rejection using another interface.

The earlier next action was to obtain explicit permission to remove only Preview/Development from that
existing store connection, preserving Production and prefix BLOB. Then verify
the saved scope and preview-only private variables, deploy the foundation
branch when its integrated source is ready, and prove actual runtime private
file use before calling O02 complete. Ask for exact owned fixture cleanup;
never delete or reset unrelated preview or production data.

At this earlier checkpoint O09 schema was blocked. The subsequent hosted
application proof above clears that infrastructure prerequisite. Keep this evidence
and property/task work in the same substantial batch; no small proof PR.
