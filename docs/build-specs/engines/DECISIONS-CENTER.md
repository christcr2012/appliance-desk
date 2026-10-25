# Build spec — Decisions & reviews center (DEC-1)

Design: `docs/designs/DECISIONS-CENTER.md` (read it first). Rule: AGENTS.md section 1 "Decisions never block
building". Chris approved building it and applying researched starting values to the live app (2026-10-25,
DECISIONS.md). DEC-2 (the researched values themselves) is separate and uses this.

## 1. Data (additive migration `20261026030000_decision_record`)

```prisma
model DecisionRecord {
  id              String   @id @default(cuid())
  subjectId       String   // registry id, e.g. "IN-34-RENT-STATE"
  kind            String   // STARTING_VALUE_APPLIED | CONFIRMED | CHANGED | SENT_TO_PROFESSIONAL | PROFESSIONAL_ANSWER | REOPENED
  audience        String   // OWNER | CPA | ATTORNEY | TRANSLATOR
  value           Json?    // the value as the setting stores it (null for SENT_TO_PROFESSIONAL / REOPENED)
  previousValue   Json?
  effectiveFrom   DateTime?   // business date the value applies from (null = immediately)
  answeredByUserId String?
  answeredBy      User?    @relation("DecisionAnsweredBy", fields: [answeredByUserId], references: [id], onDelete: SetNull)
  professionalName String?  // e.g. "Jane Doe"
  professionalFirm String?
  professionalAnsweredOn DateTime?
  explanation     String?  // max 4000
  attachmentUrl   String?  // private blob url under decisions/
  sources         Json?    // [{ title, url, checkedOn }] for STARTING_VALUE_APPLIED
  via             String   // SCREEN | IMPORT | MCP | MIGRATION
  createdAt       DateTime @default(now())
  @@index([subjectId, createdAt])
  @@index([audience, createdAt])
}
```
User: add `decisionRecords DecisionRecord[] @relation("DecisionAnsweredBy")`. Append-only: no update/delete code path
(a test greps for `decisionRecord.update`/`delete` and fails).

## 2. The registry (`src/domains/decisions/registry.ts`, pure)

```ts
export type Audience = "OWNER" | "CPA" | "ATTORNEY" | "TRANSLATOR";
export type DecisionOption = { value: Prisma.JsonValue; label: string };
export type DecisionSubject = {
  id: string;                       // stable code; printed as [DQ-{id}]
  legacyIds: string[];              // e.g. ["IN-34", "IN-25"]
  area: "TAX" | "RENTAL_TERMS" | "MONEY" | "PRIVACY" | "WORDING" | "BUSINESS";
  audience: Audience;               // who should answer by default
  title: string;                    // short, plain
  question: string;                 // plain words, one or two sentences
  facts: string;                    // what a professional needs to know; never customer data
  options: DecisionOption[];        // exactly the values the setting accepts
  allowOther: boolean;
  read: (ctx: DecisionContext) => Promise<Prisma.JsonValue>;            // current value from the real setting
  write: (tx: Prisma.TransactionClient, actorId: string, value: Prisma.JsonValue, effectiveFrom: Date | null) => Promise<void>;
  describe: (value: Prisma.JsonValue) => string;                       // value in plain words
  recommended: { value: Prisma.JsonValue; why: string; sources: { title: string; url: string; checkedOn: string }[] } | null;
  affects: { label: string; href: string }[];                          // screens that use it (real routes)
  reviewGate?: string;                                                 // name of the existing REVIEW_REQUIRED gate, if any
};
export const DECISION_SUBJECTS: DecisionSubject[];
```
- `write` **must call the domain's existing save function** for that setting with the same locks, actor checks,
  audit rows and effective-date rules (e.g. `updateBusinessSettings`, the tax setup functions, the setup-fee
  decision version writer). It never writes the setting table directly. If the existing save function only accepts a
  CPA-confirmed value (section 5), use the new provisional path from section 5.
- DEC-1 ships the registry with **every open subject from the DEC inventory** (the table in
  `docs/research/2026-10-25-open-decisions.md`, written in DEC-2's first PR; DEC-1 may start with the tax subjects
  IN-33, IN-34 (one subject per charge category × state/Greeley), IN-35, IN-37, IN-39, IN-44, IN-46, IN-56, IN-65,
  IN-71, IN-79, and the wording/terms subjects IN-07, IN-21, IN-31, IN-38, IN-52, IN-76, IN-78, IN-83, IN-84, IN-06),
  each with `recommended: null` until DEC-2 fills it.
- Tests (`tests/decisions-registry.test.ts`): ids unique and match `/^[A-Z0-9-]+$/`; every `affects.href` is a real
  route; every option value is accepted by the setting's own validator (call the domain validator with each value);
  every Prisma field whose enum has an `UNDECIDED` value (Taxability, ShortTermLeaseElection, TaxReportingBasis,
  RdfHandling) and the string fields `setupFeeTaxTreatment`, `badDebtTaxRecovery`, `retailDeliveryFeeDecision` is
  covered by at least one subject.

## 3. State and reads (`src/domains/decisions/index.ts`)

```ts
export type DecisionState = "STARTING_VALUE" | "CONFIRMED" | "WITH_PROFESSIONAL" | "NO_SOURCE";
export async function listDecisions(filter: { audience?: Audience; state?: DecisionState; area?: string }): Promise<DecisionCard[]>
export async function getDecision(id: string): Promise<DecisionCard>
```
OWNER and ADMIN may read; only OWNER may write (section 4). `DecisionCard` = subject fields + `current` (read +
describe) + `state` + `last` record + `history` (records newest first, max 50). State rules: newest record kind
CONFIRMED / PROFESSIONAL_ANSWER / CHANGED → CONFIRMED; SENT_TO_PROFESSIONAL → WITH_PROFESSIONAL; STARTING_VALUE_APPLIED
or none → STARTING_VALUE, except `recommended === null` → NO_SOURCE. Read all subjects' current values in one pass
(settings row read once, tax tables once).

## 4. Writes (`src/domains/decisions/index.ts`, all OWNER only)

```ts
export async function confirmDecision(actorId, id, expectedValue): Promise<void>      // "Keep this"
export async function changeDecision(actorId, id, value, effectiveFrom, note?): Promise<void>
export async function sendToProfessional(actorId, id, audience): Promise<void>
export async function recordProfessionalAnswer(actorId, id, input: { value, effectiveFrom, professionalName,
  professionalFirm?, answeredOn, explanation?, attachmentUrl? }, via: "SCREEN" | "IMPORT" | "MCP"): Promise<void>
export async function previewAnswers(actorId, answers: ParsedAnswer[]): Promise<AnswerPreview[]>
export async function applyAnswers(actorId, answers: ParsedAnswer[], confirmToken: string): Promise<ApplyResult>
```
- Each write: one transaction; `assertActiveTeamActor(tx, actorId, ["OWNER"])`; lock the settings row
  (`SELECT … FROM "BusinessSettings" WHERE id='singleton' FOR UPDATE`) so decisions serialize; `confirmDecision`
  re-reads the current value and refuses with "This changed since you opened it" if it no longer equals
  `expectedValue`; `subject.write(tx, …)` when the value changes; then insert the `DecisionRecord`; audit
  `decision.{kind}` with subject id.
- `effectiveFrom` must be today or later (Denver business date); refused if earlier ("A change can't apply to the
  past — signed and billed history stays as it was"). Today (or null) → `subject.write` now. Later → section 4a.

### 4a. Changes that start on a later date
Most settings (and `TaxabilityRule`, `@@unique([jurisdictionId, category])`, read by `src/domains/tax/locations.ts`
with no date) have no effective dating, so a future change is stored, not written:
```prisma
model DecisionScheduledChange {
  id            String   @id @default(cuid())
  subjectId     String
  value         Json
  effectiveFrom DateTime                  // Denver start of that business date, stored UTC
  decisionRecordId String                 // the record that scheduled it
  provisional   Boolean  @default(false)
  appliedAt     DateTime?
  cancelledAt   DateTime?                 // a later decision on the same subject cancels it
  createdAt     DateTime @default(now())
  @@index([appliedAt, effectiveFrom])
  @@index([subjectId, effectiveFrom])
}
```
(additive, in DEC-1a's migration). One pending change per subject: scheduling a new one cancels the old (same
transaction). **Applying:** the nightly `books-nightly` run (after its current work, in `runAutomation`) applies every
change with `effectiveFrom <= now` through `subject.write` with the same locks and audit, sets `appliedAt`; idempotent
(locked row, `appliedAt` re-checked). **Tax is exact to the day without waiting for the nightly run:** new
`getTaxabilityRulesAsOf(at: Date)` in `src/domains/tax/locations.ts` returns the stored rules overlaid with any
not-yet-applied, not-cancelled taxability change whose `effectiveFrom <= at` (newest per jurisdiction × category);
the tax engine and the filing screens call it with the charge's service date (invoices) or the period end (returns)
instead of reading the table directly. A grep test fails if `taxabilityRule.findMany` is used outside
`locations.ts`. Cards show "Starts {formatShortDate(effectiveFrom)}" until applied. Tests: a change for tomorrow does
not affect today's invoice and does affect tomorrow's (before the nightly run); nightly applies it once; a newer
decision cancels the pending one; DST boundary dates.
- `attachmentUrl` must be a private blob url under `decisions/` (check the prefix and the private store host).
- `previewAnswers` is pure apart from reads: for each parsed answer → `{ code, title, now: describe(current),
  after: describe(value), effectiveFrom, status: "CHANGE" | "SAME" | "INVALID", reason? }` (INVALID when the code is
  unknown, the value is not an option and `allowOther` is false, or the date is in the past). It returns a
  `confirmToken` built exactly like the bank-statement import preview token in `src/domains/books/cash/import.ts`
  (`previewToken` / `verifyToken`: base64url claims `{ v, uid, sha (hash of the canonical preview JSON), exp }` +
  HMAC-SHA256 with `BETTER_AUTH_SECRET ?? AUTH_SECRET`, refusing secrets shorter than 32 characters, constant-time
  compare). Move those two helpers to `src/lib/preview-token.ts` and use them from both places (no behavior change for
  bank imports). Valid 30 minutes.
  `applyAnswers` recomputes the preview and refuses if the token does not match (so what is applied is exactly what
  was shown), then records each CHANGE/SAME as `PROFESSIONAL_ANSWER` (SAME confirms without writing the setting).
  An "Other" answer is never applied to a setting: it is recorded as `PROFESSIONAL_ANSWER` with `value: null` and the
  card shows "Needs a change to the app" (state stays STARTING_VALUE) — the agent turns it into a code change.

## 5. Provisional values where the save path requires a CPA date (fix found by the inventory)

`saveTaxabilityCell` (`src/domains/tax/setup.ts:295-305`) refuses `UNDECIDED` and requires `cpaConfirmedOn` and a
reason; there is no way to run a researched value that is not yet confirmed. Add, without changing that function:
- `TaxabilityRule` fields (additive): `provisional Boolean @default(false)`, `provisionalReason String?`,
  `provisionalSources Json?`.
- `saveProvisionalTaxabilityCell(actorId, { jurisdictionId, category, taxability, reason, sources })` — same locks and
  OWNER check as `saveTaxabilityCell`; writes `taxability`, `provisional = true`, `cpaConfirmedOn = null`; refuses
  `UNDECIDED`.
- Confirming through the center calls the existing `saveTaxabilityCell` (with `cpaConfirmedOn` = the professional's
  answer date, or today for an owner "Keep this" — label it "Confirmed by the owner") and sets `provisional = false`.
- The tax engine (`src/domains/tax/engine.ts`) treats a provisional TAXABLE/EXEMPT exactly like a confirmed one for
  calculating, but its result carries `provisional: true`; the existing filing screens show "Starting value — not
  confirmed by your CPA" next to those categories. Real-use gates that today require a CPA date
  (`REVIEW_REQUIRED` subjects) keep requiring it — DEC-2 decides per subject, in writing, whether the provisional
  value may run live (Chris approved live starting values, but a subject whose official source says a professional
  must confirm stays gated).
- The same pattern for `ShortTermLeaseElection`, `TaxReportingBasis`, `RdfHandling`, `setupFeeTaxTreatment` and
  `badDebtTaxRecovery`: store the researched value in the existing field and record provenance in `DecisionRecord`
  (`STARTING_VALUE_APPLIED` with sources). Where the engine refuses on `UNDECIDED` today, it then calculates.
  `setupFeeTaxPlanningTreatment` already models "recommendation vs active value"; reuse it.
Tests: engine results for provisional vs confirmed vs UNDECIDED; confirming clears `provisional`; history kept.

## 6. Screens — Settings › Decisions & reviews (`/desk/settings/decisions`)

Kit only (KIT.md). OWNER sees and acts; ADMIN sees read-only (no buttons). Job role: `settings` → management
(already mapped).
- `ScreenHeader` "Decisions & reviews"; ⋯: "Import a completed form" (section 7).
- `StatusTabs` (param `for`): "For you {n}", "For your CPA {n}", "For your attorney {n}", "For a translator {n}",
  "Answered". Counts = subjects not CONFIRMED per audience (WITH_PROFESSIONAL counts under that professional).
- Filters: Area (select), State (Starting value / With a professional / No source yet).
- Card per subject (`DecisionCard` kit component — add to KIT as 4.22): title; question; "Doing now: {describe}" with
  a pill — "Starting value — not confirmed" (attention), "Confirmed by {name} on {date}" (good), "With your {CPA} since
  {date}" (info), "No public source — careful choice in use" (neutral); InfoTip "Why this starting value" = `why` +
  source links (title, "checked {date}"); "Affects: {labels as links}"; actions: **Keep this** (form → confirm),
  **Change…** (Sheet with a `Select`/`OptionCards` of the options + effective date + note → changeDecision), **Ask my
  {CPA|attorney|translator}** (menu with the three; → sendToProfessional), on professional tabs **Enter their
  answer…** (Sheet: option, effective from, name, firm, date answered, explanation, upload the completed form
  (PhotoUploadField with `pathPrefix="decisions/{id}"`, private, accepts PDF and .docx) → recordProfessionalAnswer).
- Professional tabs show a header button **Download questions** → menu "Word (.docx)" / "PDF" (section 7).
- "Answered" tab: the newest CONFIRMED record per subject, with "Reopen" (OWNER; adds REOPENED; state back to
  STARTING_VALUE with the current value kept).
- Today card (TODAY.md group `system`): "Decisions waiting: {n}" with "Open" → `/desk/settings/decisions`, shown at
  most once per 7 days per owner (store last-shown date in the O-7 workspace prefs), never high severity. A true
  blocker is never filed here (AGENTS section 1) so this card is always low.

## 7. Questionnaire forms and import

**Download** — route `/desk/settings/decisions/form?for=CPA&format=docx|pdf` (OWNER/ADMIN). Content (same for both
formats), built from `listDecisions({ audience, state ≠ CONFIRMED })`:
- Cover page: "Questions for my {CPA} — Robinson Appliance Rentals — {formatBusinessDate(today)}", the business facts
  (legal name, city, what it rents, start date — from settings), and the instructions: "Tick one answer for each
  question, add any explanation, and fill in 'Answered by'. Please keep the codes in brackets."
- One section per subject: `[DQ-{id}]` + title; question; facts; "What the app does now: {describe} — {why}";
  sources; options as `☐ {label}` lines plus `☐ Other: ________`; "Effective from: ________"; "Your explanation:"
  (5 blank lines); "Answered by / firm / date: ________".
- Last page "Answer sheet": one line per code `[DQ-{id}] Answer: ________  Effective from: ________` and
  `Explanation: ________`.
- DOCX via the `docx` package, pinned **9.9.0** (released 2026-10-07; newer versions were under two weeks old on
  2026-10-25). PDF via the existing `pdf-lib` (already a dependency, used by `src/domains/tax/dr0252-form.ts`):
  simple text layout, A4/Letter, Manrope is not embedded (use Helvetica). Filename
  `decisions-{audience}-{YYYY-MM-DD}.{ext}`. Test: both formats contain every open code exactly once in the body and
  once on the answer sheet.

**Import** — `/desk/settings/decisions/import` (OWNER): upload a completed **.docx** (read with `mammoth` pinned
**1.13.0**, `extractRawText`) or paste text (for PDFs and scans the coding agent reads the document itself and uses
the MCP tools). `parseQuestionnaireAnswers(text): ParsedAnswer[]` (pure, `src/domains/decisions/parse.ts`): finds
each `[DQ-…]` code; within its section, the ticked option (`☒`, `☑`, `[x]`, `X` before the option label, or the
answer-sheet "Answer:" text matched case-insensitively to an option label), "Effective from" date (formats
YYYY-MM-DD, M/D/YYYY, "Month D, YYYY"), explanation text, answered-by line. Unknown codes are reported, not
guessed. Then the preview table (code, title, now → after, effective, status) and "Apply {n} changes" → applyAnswers
with the token; the uploaded file is stored as the attachment on every record it produced. Tests: a fixture .docx
produced by the download route, filled programmatically, round-trips to the same answers; handwritten-style answer
sheet text parses; ambiguous tick (two boxes) → INVALID with "Two answers were ticked".

## 8. MCP tools (read tools in MCP-4, write tools in MCP-5 — see `engines/CONNECT-AGENT.md` and `engines/AGENT-ACTIONS.md`)

Reads (scope `decisions:read`): `appliance_decisions_list { audience?, state? }` → cards (no customer data) and
`appliance_decisions_get { id }`. Writes (scope `decisions:apply`, journaled operations): `appliance_decisions_preview_answers
{ answers: [{ code, option | otherText, effectiveFrom?, explanation?, answeredBy?, firm?, answeredOn? }] }` → the
`previewAnswers` result with its `confirmToken`, and `appliance_decisions_apply_answers { answers, confirmToken,
requestKey }` → `applyAnswers`. They call these functions only — no other write path. This is how Chris's coding
agent applies a completed professional form: it reads the document, calls preview, shows Chris the table, and applies
only after he says yes in the conversation (the confirm token binds the apply to exactly what was previewed). An
"Other" answer is never applied to a setting; the agent turns it into a code change in the repository instead.

## 9. Tests summary
Registry, state rules, each write's locks/actor/refusals (fakes + throwaway Postgres), effective-date refusal,
append-only guard, provisional taxability engine behavior, form round trip, parser cases, import preview/apply with
token mismatch refused, ADMIN read-only and STAFF refused (browser spec `e2e/decisions.spec.ts`: keep, change, ask,
enter answer with upload, download both formats, import), axe + 5 sizes.
