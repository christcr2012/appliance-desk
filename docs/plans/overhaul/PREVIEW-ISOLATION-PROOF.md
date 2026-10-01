# Hosted preview isolation evidence — 2026-10-01

Status: runtime DB and provider private-store checks passed; original store
restricted to Production, original owned fixtures removed. O02 remains
incomplete pending hosted application private-file proof and batch gate G.

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
same batch. Hosted execution of the new page is still pending.

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
they contain temporary access signatures. No hosted application private-file
write/read using the newly injected variables has been demonstrated yet.
Existing deployed previews predate the connection and require a new deployment
to receive its variables. Photo-token and backup preview guards remain closed.

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

O09 schema remains blocked on full O02. Keep this evidence and the already
implemented property context in the same substantial batch; no small proof
PR or full-CI rerun for this checkpoint.
