# Decisions & reviews — decisions never block the work (Batch DEC)

Status: **designed 2026-10-25 at Chris's request; not built.** Rule: AGENTS.md section 1, "Decisions never block
building". Units DEC-1 (the center) and DEC-2 (apply researched starting values to every open decision) in
`work-index.json`. Builds on — and replaces the "no new approval queue" line of —
[PROFESSIONAL-REVIEW-IMPLEMENTATION.md](PROFESSIONAL-REVIEW-IMPLEMENTATION.md), whose policy/evidence contract
stays the engine underneath.

## 1. The problem (Chris, 2026-10-25)

> "agents have lost track of my intended design flow and keep putting off implementation based on waiting for
> decisions to be made by owner or other professionals, instead of doing real research … building in
> configurability and applying the most likely decision for my business, in my country, in my state at my stage of
> business, and making that likely decision the default that can be changed in the system … The rest should be added
> to their own respective questionnaire forms for me to answer … or to have a CPA or lawyer, or translator to answer
> later, after which I would address those things also from within the system."

What went wrong (checked 2026-10-25): open questions live in `docs/OWNER-INPUTS.md` (IN-xx) and
`docs/OWNER-CHECKLIST.md`, which Chris never sees inside the app; many settings start as `UNDECIDED`
(`shortTermLeaseElection`, `TaxReportingBasis`, `Taxability`, `setupFeeTaxTreatment`, `badDebtTaxRecovery`, …), and
code treats `UNDECIDED` as "stop". The result is features that are built but cannot be used until someone answers a
document Chris does not read.

## 2. The idea in one paragraph

Every open business, legal, tax or wording decision has **a researched starting value already in effect** (the most
likely right answer for a new, one-owner appliance-rental LLC in Greeley, Weld County, Colorado), **changeable in
Settings**, and **a question waiting in the app** for the right person: Chris, his CPA, his attorney or a translator.
Answering the question is how the setting gets confirmed or changed. Professionals do not need accounts: Chris
prints or sends their question set, then records their answers (and attaches their letter or email). Only a true
blocker — something that cannot be built at all, or would be unsafe, illegal or irreversible to run on the default —
is raised with Chris immediately in conversation, and only that one operation waits.

## 3. What Chris sees

**Settings › Decisions & reviews** (profile menu → Settings; also a card on Today while anything is waiting, at most
once a week, never urgent unless a true blocker exists):

- Four tabs with counts: **For you** · **For your CPA** · **For your attorney** · **For a translator** · and
  **Answered** (history).
- Each question is a card:
  - The question in plain words ("Should bills for shop sales include the Colorado retail delivery fee?").
  - **"Doing now:"** the current value in plain words, marked **Starting value — not confirmed** (amber) or
    **Confirmed by {who} on {date}** (green).
  - **Why this starting value** — one or two sentences, behind ⓘ, with the sources (official links + the date they
    were checked) and what most similar businesses do.
  - **What it affects** — the screens or actions that use it ("Shop sale bills", "Monthly rent tax").
  - Buttons: **Keep this** (confirms the starting value as Chris's answer), **Change…** (opens the same editor the
    Settings page uses for that setting, inline), **Ask my CPA / attorney / translator** (moves it to that tab,
    keeps the current value running), and for professional tabs **Enter their answer…**.
  - Professional cards show **"Real use waits for this review"** only when that subject is `REVIEW_REQUIRED` (the
    existing professional-review gate); otherwise "You can use this now; their answer may change it".
- **Print or send the questions** on each professional tab: a clean printable page (and PDF via the browser) titled
  "Questions for my CPA — Robinson Appliance Rentals", listing each question, what the app does now, the facts they
  need (no customer data), and space for their answer. "Copy as email" puts the same text in the clipboard.
- **Enter their answer…**: who answered (name, firm), date, their answer (the same choices the setting offers, or
  "Other" with text), effective date ("from today" default; future dates allowed; never backdated over signed or
  billed history), optional attachment (their letter/email as a stored file), and a note. Saving confirms or changes
  the setting and records the evidence.

## 4. How it works underneath

- **One registry in code** (`src/domains/decisions/registry.ts`) — every decision subject the app knows:
  `{ id: "IN-34" | "DQ-…", title, question, audience: "OWNER" | "CPA" | "ATTORNEY" | "TRANSLATOR", settingKeys,
  readValue(settings) → plain words, options, recommendedValue, why, sources: { url, title, checkedOn }[], affects,
  reviewGate?: string }`. Adding a decision anywhere in the app means adding one registry entry; a test fails if a
  setting that can be `UNDECIDED` (or any registry `settingKeys` field) has no entry, or an entry points at a
  setting that does not exist.
- **One table of answers** `DecisionRecord` (additive): subject id, kind (`STARTING_VALUE_APPLIED`, `CONFIRMED`,
  `CHANGED`, `SENT_TO_PROFESSIONAL`, `PROFESSIONAL_ANSWER`, `REOPENED`), value (JSON, as the setting stores it),
  previous value, audience, answered by (user id) / professional name and firm, effective from, note, attachment
  (stored file id), created at. Append-only; the current state of a subject = its newest record. The setting itself
  stays where it lives today (BusinessSettings, tax policy tables, effective-dated policy histories) — the center
  never duplicates the value, it writes through the same save functions the Settings page uses (same locks, actor
  checks, audits, effective-date rules).
- **`UNDECIDED` stops meaning "stop".** DEC-2 replaces each `UNDECIDED` starting value with the researched value
  (as a future-dated policy revision where the domain has effective dates; for new installs as the default) and
  records `STARTING_VALUE_APPLIED` with its sources. Where research cannot support any value, the subject keeps its
  current safe behavior and its card says so plainly ("No public source settles this; the app does X, the most
  careful choice, until your CPA answers").
- **Professional review gates stay narrow.** `REVIEW_REQUIRED` subjects still lock only the specific real business
  use (from the professional-review contract). A `PROFESSIONAL_ANSWER` record with an attachment is the evidence
  that unlocks it.

## 5. What counts as a true blocker

Raised with Chris **in the conversation immediately**, never queued:
1. Code cannot be written without the answer (two incompatible designs and no safe way to support both).
2. Running on a default would move real money, send a real customer message, create a signed document, file with a
   government, or delete data in a way that cannot be undone — and the default could be wrong.
3. The default would be illegal on its face per an official source.
Everything else: researched starting value + question.

## 6. Units

- **DEC-1 — the center**: registry, `DecisionRecord`, Settings › Decisions & reviews (tabs, cards, Keep/Change/Ask,
  professional answers with attachments, print/copy), Today card, migration of every open IN-xx from
  `docs/OWNER-INPUTS.md` into registry entries (existing answers become `CONFIRMED` records dated to their original
  answer, with the DECISIONS.md reference in the note), tests.
- **DEC-2 — researched starting values**: for every open subject, the research (official sources with access
  dates, saved in `docs/research/`), the chosen starting value and why, applied through the domain's own save path;
  each subject's card shows it. Done in batches by area (tax; rental terms and notices; money and books; privacy and
  records; wording and Spanish) so each PR is reviewable.

## 7. Owner decisions

None needed to build. (This design applies Chris's own direction.)
