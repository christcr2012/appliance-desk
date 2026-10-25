# Build spec — Repair cases: from a problem to a checked fix (MCP-6)

Card: `docs/pr-cards/MCP-6.md`. Design: `docs/mcp/ARCHITECTURE.md` ("Three independent authority boundaries", repair
stages) and `DATA-AND-RECOVERY.md` (RepairCase). Depends on MCP-5. Approved by Chris 2026-10-25.

**What Chris gets:** when an assistant finds a problem it can't fix with a button (a bug in the code), it opens a
private **repair case** in the app with what is wrong, what should happen and how to check. His coding agent fixes it
in GitHub as usual; the app only accepts "PR opened / merged / live / checked" when it can see it for itself, so a
case never says "fixed" because someone claimed so.

## 1. Data (additive)
```prisma
model RepairCase {
  id            String   @id @default(cuid())
  number        Int      @unique @default(autoincrement())
  sourceKind    String   @db.VarChar(20)    // SYSTEM_ISSUE | FEEDBACK
  sourceId      String
  sourceVersion Int
  fingerprint   String   @db.Char(64)        // sha256(sourceKind:sourceId:expectedBehavior)
  title         String   @db.VarChar(160)    // safe, no personal details (checked with the ops redaction helper)
  expectedBehavior String @db.VarChar(2000)
  howToCheck    String   @db.VarChar(2000)   // which health rule / issue / test must pass
  baselineRevision String @db.VarChar(40)    // app revision when opened
  stage         RepairStage                   // PROPOSED | IN_PROGRESS | PR_OPEN | MERGED | DEPLOYED | VERIFIED | REJECTED | SUPERSEDED | FAILED | BLOCKED
  prNumber      Int?
  mergeSha      String?  @db.VarChar(40)
  deployedRevision String? @db.VarChar(40)
  verifiedAt    DateTime?
  blocker       String?  @db.VarChar(500)
  version       Int      @default(1)
  createdByUserId String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  evidence      RepairEvidence[]
  @@unique([fingerprint])
  @@index([stage, updatedAt])
}
model RepairEvidence {
  id        String @id @default(cuid())
  caseId    String
  case      RepairCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  kind      String @db.VarChar(20)   // PR | COMMIT | CHECK | DEPLOYMENT | RUNTIME_CHECK
  ref       String @db.VarChar(200)  // PR number, sha, check name
  status    String @db.VarChar(12)   // CANDIDATE | VERIFIED | REJECTED
  verifier  String? @db.VarChar(40)  // "github-public-api" | "running-app" | "health-rule"
  checkedAt DateTime?
  detail    Json?
  createdAt DateTime @default(now())
  @@index([caseId, createdAt])
}
```

## 2. Verifying evidence (`src/domains/agent-control/repair-cases.ts`)
- Allowed repository: the constant `christcr2012/appliance-desk` only (this public repo). Any other repo → REJECTED.
- PR/commit/check evidence is checked by the server with unauthenticated `fetch` to fixed paths on
  `https://api.github.com` only (`/repos/{repo}/pulls/{n}`, `/repos/{repo}/commits/{sha}/check-runs`,
  `/repos/{repo}/compare/{base}...{head}`), 10 s timeout, no redirects followed to other hosts, response size cap
  1 MB. The caller's claimed conclusions are ignored. PR_OPEN = PR exists and is open with base `main`; MERGED = PR
  merged and `merge_commit_sha` recorded; check `ci` concluded success on the merge sha.
- DEPLOYED = the running app's own `VERCEL_GIT_COMMIT_SHA` equals the merge sha **or** the compare API says the merge
  sha is an ancestor of it (checked by the nightly sweep and by `appliance_repair_check`). The app never asks Vercel.
- VERIFIED = after DEPLOYED, the case's `howToCheck` passes in the running app: for a SYSTEM_ISSUE source, the issue's
  rule has a SUCCEEDED run after deployment and the issue is resolved; for FEEDBACK, the owner (or the reporter via
  "Ready to check") confirms. A failed check → FAILED with the reason; the source stays open.

## 3. Tools (journaled through MCP-5, scope `repairs:write` — "Open and track repair cases for problems it finds")
`appliance_repair_create_case { sourceKind, sourceId, expectedBehavior, howToCheck, requestKey }` (one active case
per fingerprint: same fingerprint returns the existing case), `appliance_repair_link_evidence { caseId, kind, ref }`
(stored CANDIDATE, then verified), `appliance_repair_check { caseId }` (re-runs verification), and read tools
`appliance_repair_list_cases` / `appliance_repair_get_case` (scope ops:read). The repair-case text given to GitHub by
the coding agent must be the case's safe fields only — the app never posts to GitHub.

## 4. Screen
System health › **Repairs**: list with number, title, stage words ("Waiting to start", "Being worked on", "Change
ready for review", "Change accepted", "Live", "Checked and fixed", "Didn't fix it", "Stuck: {blocker}"), link to the PR
on GitHub (public), and the source (issue or feedback number). OWNER can reject or mark superseded with a reason.

## 5. Tests
`tests/mcp-repair-cases-integration.test.ts` with a fake GitHub server (the fetch is injected): foreign repo
rejected; fabricated PR number rejected; caller-claimed "success" ignored; open → merged → deployed (ancestor) →
verified only with a later successful run; failed verification keeps the issue open; duplicate create returns one
case; title with a planted email refused by redaction.
