# Build specs — how to implement the app redesign (for the implementing model)

These specs turn [designs/APP-REDESIGN.md](../designs/APP-REDESIGN.md) into exact build instructions. They were written
so a smaller, cheaper model can build every screen **without making design decisions**. Every decision is already
made here. If a business, tax, legal or wording choice you need is not decided, follow **AGENTS section 1 "Decisions never block
building"**: research it, build it as an owner setting whose starting value is the most likely right (or, without a
source, the most careful) answer, explain it on screen, and file the question in Decisions & reviews (until DEC-1
ships, a `DQ-` entry in `docs/OWNER-INPUTS.md`) — then keep building. Stop only for a true blocker (it can't be built
at all, or the default would be unsafe or irreversible) and tell Chris at once. A missing **design** detail (color,
layout, spacing) is not a decision: use the KIT tokens and the nearest existing screen's pattern, and note it in the PR.

## Read in this order (every session)

1. `/AGENTS.md` — the rules. They win over everything here.
2. This file.
3. [KIT.md](KIT.md) — tokens and every shared component's exact contract.
4. The execution card you are building (`docs/pr-cards/AR-*.md`).
5. The screen spec(s) that card names (`docs/build-specs/screens/*.md`).
6. The sample markup for that screen in `docs/build-specs/samples/` — it is the **visual target** (spacing, sizes,
   hierarchy). It is a static mockup: copy its layout and proportions, not its inline styles; build with the kit and
   Tailwind tokens.

## The definition of done for every card (in addition to AGENTS section 3)

- Every acceptance line in the card is checked with evidence (test name, browser spec name, or CI job).
- Browser specs run at **360×740, 390×844, 820×1180, 1280×800, 1920×1080** with axe and keyboard checks
  (`e2e/` — add each new spec to a group in `e2e/shards.json`).
- The kit guards (KIT.md section 9) pass with no new allow-list entries.
- The plain-words check passes (`npm run lint`).
- No business behavior changed: the same server actions and domain functions are called with the same arguments.
  If a screen needs new data, add a **read-only** query function in the named domain file, with a unit test.
- Every old URL still works (the page itself, or a redirect listed in the card).
- STATUS has a short top entry. The card's "Progress" section says what was done and what was not.

## How to work through a card

1. Branch `ai/<tool>/<card-id>` from current `main`.
2. Do the card's steps **in order**. Each step names the files to create or change. Do not touch files the card
   does not name unless a type error forces it (then say so in the PR).
3. Write the tests the step lists while you build that step.
4. Run the cheap checks locally (`npx vitest run <changed tests>`, `npm run lint`, `npx tsc --noEmit`), push once,
   let CI run the full suites (AGENTS section 8).
5. Open the PR with the card's PR text filled in. Merge per AGENTS section 6.

## Rules that are easy to get wrong

- **Never change money behavior.** Buttons call the existing server actions listed in the screen spec. A refund,
  payment, write-off or deposit decision is never optimistic and always shows the plain confirmation in KIT.md 6.6.
- **Filter on the server.** A tab, badge, count or row a role must not see is removed in the query, not hidden in UI.
- **Words.** Use the exact strings in the screen specs. When a string is not given, use KIT.md section 8's
  dictionary. Never show a stored status code, an ID, or "invoice/receivable/journal/reconcile" on everyday screens.
- **No explanatory paragraphs.** Help goes in an `InfoTip`. Page headers have no description.
- **Phone first.** Build the 390 px layout first, then add the `lg:` (≥1024 px) layout. Never hide a feature on phones.
- **Dates and money.** Dates via `formatBusinessDate` / `formatBusinessTime` (`src/lib/business-date.ts`); money via
  `formatMoney` (`src/lib/money-ui.ts`). Never format by hand.
- **Read the Next.js guide before framework code** (AGENTS section 4): the guides named in KIT.md section 7 live in
  `node_modules/next/dist/docs/01-app/02-guides/`.

## Where things are

| What | File |
|---|---|
| Design (why) | `docs/designs/APP-REDESIGN.md` |
| Kit (what to build with) | `docs/build-specs/KIT.md` |
| Screen specs | `docs/build-specs/screens/` |
| Visual targets | `docs/build-specs/samples/*.dc.html` (also on Chris's private design canvas) |
| Execution cards | `docs/pr-cards/AR-0.md` … |
| Tokens (CSS) | `src/app/globals.css` (`@theme`) |
| Existing components | `src/components/ui/*`, `src/components/desk/*` |
