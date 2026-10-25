# Build spec — Business records vault and guided setup (VAULT-1, VAULT-2, SETUP-1)

Requested by Chris 2026-10-25: walk the owner through getting everything set up, and store the information so he never
has to remember due dates, accounts and account numbers, usernames and passwords, articles of organization, tax ids,
licenses, permits, TCCs. Design: `docs/designs/OWNER-OPERATING-SYSTEM.md`. Builds on the existing **Business
paperwork** list (`src/domains/paperwork/*`, model `BusinessPaperwork`, starter templates in `templates.ts`, To do via
`listPaperworkAttention`). Read `docs/AI-PR-READ-FIRST.md` (secrets, uploads, auth). Depends on CMP-1 (field
encryption helper `src/lib/field-crypto.ts`) and ACC-6 (sign-in code verification helpers).

## VAULT-1 — Business records (documents, numbers, dates)

### 1. Data (additive migration `20261103000000_business_records`)
Extend `BusinessPaperwork` (it becomes "a business record"; the screen is renamed **Business records**, URL
`/desk/paperwork` kept):
```prisma
  kind            String  @default("TASK")    // TASK | LICENSE | PERMIT | REGISTRATION | TAX_ACCOUNT | INSURANCE | BANK | DOCUMENT | ACCOUNT | VEHICLE | CONTRACT
  issuedOn        DateTime?
  expiresOn       DateTime?                   // separate from dueOn (next action); renewal To do uses the earlier
  numberLabel     String? @db.VarChar(60)     // "EIN", "Colorado account number", "Policy number", "TCC"
  numberEncrypted String?                     // encryptField(); referenceNumber stays for non-sensitive refs
  numberLast4     String? @db.VarChar(4)
  portalUrl       String? @db.VarChar(500)
  credentialId    String?                     // VAULT-2 link
  costCents       Int?                        // yearly/renewal cost, feeds the budget and Schedule C mapping
  linkedObligationKeys String[]               // CMP registry keys this record unlocks/feeds
```
```prisma
model BusinessRecordFile {
  id        String @id @default(cuid())
  recordId  String
  record    BusinessPaperwork @relation(fields: [recordId], references: [id], onDelete: Restrict)
  pathname  String @unique                   // records/{recordId}/{id}.{ext} in the PRIVATE store
  fileName  String @db.VarChar(200)
  contentType String @db.VarChar(80)         // application/pdf, image/png|jpeg|webp only (magic bytes)
  sizeBytes Int
  sha256    String @db.Char(64)
  label     String? @db.VarChar(120)         // "Articles of Organization (filed copy)"
  uploadedByUserId String
  createdAt DateTime @default(now())
  deletedAt DateTime?
}
```
Private storage: add `records` to `isPrivatePhotoPath`; uploads through a server action one file per request (≤ 900 KB
after the browser shrinks images; PDFs up to 900 KB direct — larger PDFs: the client uploads to Blob with a
server-issued one-use token bound to the record via `canUploadPhoto` adding `records/{recordId}/…` for OWNER only,
max 15 MB, PDF only). Read route `src/app/api/records/files/[id]/route.ts` (OWNER, and ADMIN only for kinds the owner
marks "admins may see"), `Cache-Control: private, no-store`. Backup: rows backed up; files in the nightly media copy.

### 2. Starter records (extend `templates.ts`; "Add the starter list" stays idempotent by `templateKey`)
Add, each with kind, agency, official URL, what it is in plain words, `numberLabel`, `repeatEveryMonths`/expiry rule,
and the CMP obligation keys it feeds: Articles of Organization (DOCUMENT, SOS), Operating agreement, EIN confirmation
letter (CP 575 / 147C) (TAX_ACCOUNT, number "EIN"), Colorado sales tax license (LICENSE, expires Dec 31 odd years via
`co.license.expiry`), Colorado account number (SUTS/Revenue Online), Greeley business license + sales tax account,
Weld County assessor account (business personal property), IRS IRIS TCC (and A2A TCC later), IRS online account /
EFTPS enrollment, Colorado Revenue Online login, SOS account (periodic report month), Trade name filing, Business
bank account(s), Stripe account, Google Workspace / domain (renewal date and cost), Vercel / Neon plans, Insurance:
general liability, commercial auto, equipment/inland marine (policy number, insurer, agent phone, renewal, COI file),
Vehicle: title, registration (renewal month), USDOT (only if GVWR ≥ 16,001), Resale/exemption certificates the business
gives suppliers, Twilio/A2P registration (when texting), CPA engagement letter. Each starter is only *offered*; Chris
adds what applies.

### 3. Screen — Business records (`/desk/paperwork`, OWNER; ADMIN read of non-sensitive kinds)
Tabs: **Needs you** (due/expiring within reminder window, missing files for kinds that need one), **All**, **Coming up**
(next 12 months as a list by date), **Files**. Record page: title, kind pill, status, numbers (masked; "Show" needs the
vault unlock in VAULT-2 for `numberEncrypted`), dates (issued, expires, next action), portal link, linked login (VAULT-2),
files with preview/download, history (audit), cost. ⋯: "Renewed…" (new expiry + optional new file — keeps the old file
as history), "Replace file", "Archive". Search across titles, labels, agencies, file labels. **Export pack**: choose
records → a ZIP of their files + a PDF index (for a CPA, lender, insurer), OWNER, audited, numbers masked unless Chris
ticks "include full numbers" after a vault unlock.
To do: expiring/due records at `remindDaysBefore` (existing), and for renewals with a window the CMP timing rule.

## VAULT-2 — Logins and secret numbers (encrypted, owner only)

### 4. Data
```prisma
model VaultCredential {
  id            String @id @default(cuid())
  title         String @db.VarChar(120)          // "Colorado Revenue Online"
  url           String? @db.VarChar(500)
  usernameEncrypted String?
  passwordEncrypted String?
  notesEncrypted    String?                       // security answers, recovery codes, PINs
  totpHint      String? @db.VarChar(120)          // where the 2-step code comes from ("Authenticator on Chris's phone") — never the TOTP secret
  lastRotatedOn DateTime?
  rotateEveryMonths Int?                          // optional reminder
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  version       Int @default(1)
}
model VaultUnlock {
  id        String @id @default(cuid())
  userId    String
  sessionId String
  expiresAt DateTime                              // now + 5 minutes
  createdAt DateTime @default(now())
  @@index([sessionId, expiresAt])
}
```
Encryption: `src/lib/field-crypto.ts` with a **separate** key `VAULT_ENCRYPTION_KEY` (not the compliance key), AES-256-GCM,
`v1:` prefix; the key never in the database or backups. Backup policy: `VaultCredential` backed up **still encrypted**
(restoring without the key leaves it unreadable — the restore guide says so); `VaultUnlock` → null (not backed up).
Missing key → the vault screen says "Not set up yet" with the checklist row; nothing can be saved.

### 5. Rules (every one tested)
- **OWNER only.** ADMIN/STAFF/CUSTOMER: not found. No MCP tool, ops API, export, search index, notification, log line,
  error report or AI feature ever reads these fields (a grep test fails if `passwordEncrypted|usernameEncrypted|
  notesEncrypted|numberEncrypted` appear outside `src/domains/vault/` and `src/domains/paperwork/` plus their tests).
- **Unlock to reveal.** Listing shows titles, URLs and masked usernames. "Show" or "Copy" needs an unlock: Chris enters a
  fresh sign-in code (the same second-step methods his login uses, verified through the existing Better Auth two-factor
  server functions — no new code system), creating `VaultUnlock` for this session for 5 minutes. Each reveal/copy is
  audited (`vault.reveal`, record id, field — never the value). Revealed values hide again after 30 seconds; copy clears
  the clipboard after 30 seconds where the browser allows.
- **Saving** a new or changed secret also needs an unlock (prevents someone at an open laptop from swapping a value).
- **Rate limits**: 5 failed unlock codes in 15 minutes → vault locked for 30 minutes + owner email (existing switch).
- **Signing out everywhere / password change** deletes all `VaultUnlock` rows.
- The screen shows a short honest note: "Stored encrypted. For the most sensitive logins (your bank), a password
  manager is safer; you can keep just a note here." (Decisions question VAULT-BANK, owner, starting value: allowed.)

### 6. Screen — Vault (`/desk/vault`, OWNER)
List (title, url, masked username, linked records, "Change every {n} months" due), record page with Show/Copy per
field, "Add login", rotation reminders on To do (only when `rotateEveryMonths` set). Linked from each business record
("Login: Colorado Revenue Online").

### 7. Emergency access (designed; switched on only by Chris)
Setting `emergencyContact` (name, email, phone) + `emergencyWaitDays Int @default(7)` (1–30). The contact gets no
account and no access by default. If Chris turns on "Emergency access", the contact can request it from a page
`/emergency/{token}` (link Chris gives them); the app emails/texts Chris (existing internal switch) and starts the wait;
Chris can deny any time; after the wait with no denial, the contact gets a time-limited **read-only** export (ZIP of
records + the vault decrypted into a PDF, delivered by a one-time link valid 24 hours, audited). Building this needs
Chris's explicit "turn on" (it widens access — AGENTS section 1) — the feature ships off. Attorney question
`CONT-SUCCESSOR` (who may run or close the LLC if Chris can't) in Decisions.

## SETUP-1 — Guided setup (walk Chris through every account)

### 8. Walkthroughs (`src/domains/setup/walkthroughs.ts`, pure data + checks)
`Walkthrough = { key, title, why, unlocks: string[] /* CMP keys, features */, needs: string[] /* what to have ready */,
steps: { title, body /* plain steps, exact menu names */, link?, record?: { templateKey, fields } /* where the
result is saved */, check?: CheckKey }[], estimatedMinutes }`. A check is something the app can verify itself:
`ENV_PRESENT(name)` (presence only, never value), `STRIPE_CONNECTED`, `RECORD_HAS_NUMBER(templateKey)`,
`RECORD_HAS_FILE(templateKey)`, `TAX_ACCOUNT_SET(kind)`, `WEBHOOK_SEEN`, `EMAIL_SENDS_OK` (test send to the owner), etc.
Initial walkthroughs (one each): Business basics (LLC, registered agent, operating agreement upload, trade name), EIN,
Bank account and Stripe, Colorado sales tax license + Revenue Online + SUTS, Greeley license + portal, Weld assessor,
IRS online account + EFTPS / Direct Pay, IRIS TCC, Insurance (three policies), Vehicle (registration, insurance, USDOT
check), Email domain (Workspace), Texting (Twilio/A2P, when chosen), Encryption keys (compliance + vault keys in Vercel,
step-by-step; checks `ENV_PRESENT`), Your CPA (send the questionnaire and the books export), Backups (confirm private
storage — MCP-2). The OWNER-CHECKLIST rows for these link to the walkthrough instead of repeating steps.

### 9. Screen — Set up your business (`/desk/setup-guide`, OWNER)
Progress ring per walkthrough ("4 of 6 steps"), next suggested walkthrough (by what it unlocks soonest — e.g. IRIS TCC
before Jan 31), step page with the body, link, "I did this" (records the step; asks for the number/file the step
produces and saves it into the business record/vault in the same flow), and automatic "Checked ✓" when a check passes.
Today card "Set up: {next walkthrough}" until all required ones are done (dismissable per walkthrough "Not for me").

### 10. Tests
Encryption round trip and key separation; OWNER-only reads everywhere (ADMIN/STAFF/CUSTOMER not found); unlock flow
(fresh code required, 5-minute expiry, sign-out clears); grep test for secret fields; audit rows never contain values;
file uploads (magic bytes, size, private path, read authorization); export pack masking; walkthrough data (every link
https, every `record.templateKey` exists, every check implemented); emergency access off by default and the wait/deny
logic (when turned on in a test).
