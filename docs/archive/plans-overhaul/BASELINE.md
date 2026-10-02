> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on 2026-10-02.
> Nothing in this file is a current instruction; any "current", "next" or
> "supersedes" language below is historical. The working documents are
> `AGENTS.md`, `docs/STATUS.md`, `docs/PLAN.md` and `docs/PLAYBOOK.md`.

# O00 baseline reconciliation — 2026-09-30

Batch B1 authorized by Chris: “Begin batch B one.” Selected settings updated
to Sol Medium for B1/B3/B5 and Luna High for B2/B4, matching Chris's picker.
Model switch notification is trusted; reasoning selection is user-directed,
not independently detected. Claude review of the full PR stack remains pending.

Observed GitHub chain: main -> #86 prelaunch -> #87 plan. #86 is OPEN/unmerged
at c907d2e659e7a77a0329f2b8be596199409ed49a. #87 is OPEN/unmerged at
340acf583f181faadaa88c8d3754d8af16b5d9f9, targeting #86's branch. O00 is
branched from that exact #87 head; its PR targets #87. No main changes.

## Implemented evidence (repository paths, not completion claims)

| Area | Real files to preserve |
|---|---|
| Evergreen and logo | src/app/globals.css; public/brand/logo-light.svg; public/brand/logo-dark.svg; public/brand/mark.svg |
| Migration/build gate | package.json vercel-build; scripts/check-migrations.mjs; scripts/verify-schema-health.ts; .github/workflows/ci.yml |
| Scheduled exports | src/domains/backup/index.ts; src/app/api/cron/backup/route.ts |
| Photos | src/app/api/uploads/photo/route.ts; src/components/photo-upload-field.tsx; tests/portal-maintenance-photos.test.ts |
| CRM | src/domains/customers/index.ts; src/domains/customers/timeline.ts; src/domains/leads/index.ts; src/domains/tasks/index.ts |
| Rentals and scheduling | src/domains/agreements/index.ts; src/domains/jobs/index.ts; src/domains/jobs/dispatch.ts |
| Payments and portal | src/domains/billing/index.ts; src/domains/portal/index.ts; tests/customer-isolation.test.ts |
| Prelaunch dependency (#86) | src/domains/launch/index.ts; src/app/desk/launch/page.tsx; tests/launch-integration.test.ts |

Old navy/teal and missing-logo descriptions are historical. Manual migration
instructions and “no scheduled export” notes are marked superseded. Existing
backup code does not prove a recent successful export or tested restore;
operational verification stays required. Existing photo upload is preserved;
new photography is IN-10, not a missing upload implementation.

Owner inputs IN-01 through IN-16 are stable and remain independent of card
completion. Workspace tasks GW-01 through GW-14 are delegated to Claude,
NOT_STARTED; owner-reported connection does not prove Admin setup.

## Source verification and limitations

GitHub's complete recursive tree contains 404 non-document blobs. Local
application/config/test text matches their Git blob hashes after removing
the snapshot's one extra trailing newline. Exceptions are historical skill
reference and brand/image manifest artifacts from the recovered snapshot;
these are not published or modified by O00. Remote GitHub is authoritative.
Every published tree builds on the remote predecessor, retaining original
assets. Local fake snapshot commit IDs are never pushed as repository history.

CI pull_request has no base-branch filter, so stacked PRs remain eligible.
No application behavior changed in O00; no old test count is reused as proof.
O01 must resolve role visibility using business rules; O02 must verify both
preview migration and runtime isolation before O09/O13 schema changes.

O00 acceptance: baseline/file links reconciled; stable decision IDs present;
implementation status distinct from plan; no main merge. Document checks only.
