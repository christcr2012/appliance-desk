> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on 2026-10-09.
> Nothing in this file is a current instruction; any "current", "next", "approved" or
> "supersedes" language below is historical. The prompt was answered; the answer is in the
> designs it produced. The working documents are `AGENTS.md`, `docs/SESSION-START.md`,
> `docs/STATUS.md`, `docs/PLAN.md` and `docs/PLAYBOOK.md`.

# Prompt — write `docs/designs/BATCH-E2.md` (run in a separate chat with a stronger-reasoning model)

You are writing the implementation design for **Batch E2 — Visual redesign** of Appliance Desk
(repo `christcr2012/appliance-desk`, public). Follow `docs/designs/TEMPLATE.md` exactly.

Read first: `AGENTS.md`, `docs/START-HERE.md`, `docs/STATUS.md`, `docs/PLAN.md` (section "Batch E2" and Batch E),
`docs/designs/README.md` (drift check), `docs/designs/BATCH-E.md`, `docs/DESIGN-SYSTEM.md`, `docs/brand/`
(especially `03_Design_System/brand-tokens.json` and the brand handoff rules), `docs/plans/overhaul/DESIGN.md`, and the
ROADMAP entry "Owner desk and public site visual redesign", and the mockup copy in `docs/design-mockups/redesign-2026-10-04/`. Verify against the code at the current `main` after Batch E has merged;
if E has not merged, say so and write the design as DRAFT with the assumptions listed in section 0.

Facts already decided (do not re-open):
- Look: dark evergreen side menu with a lime "current page" pill, ivory working area, one gradient headline stat card beside plain white
  stat cards, visit rows with a status word and icon, "Needs your attention" panel. Chris approved the owner desk direction.
- Inspiration only from modern component sites; no third-party UI library code or assets are used. Brand tokens from the kit only
  (cards 16px radius, controls 8px, Manrope font, dark tokens from the kit).
- Phone: bottom tab bar (Today, Schedule, Customers, Billing, More), one dominant action, tables become cards, tap targets 44px+.
- The mockup text is placeholders; real text comes from settings, agreement terms and BUSINESS-RULES. No invented claims.
- The public home page direction is NOT approved; the design must propose options and record the choice as an OWNER-INPUTS entry.
- Visual layer only: no behavior, permission, money or schema changes.

The design must give: shared component inventory (file names, props), the screen-by-screen migration order as work units sized as a stack
of PRs (per AGENTS.md), the token/lint guard against hard-coded styling, the contrast measurement method (axe plus a hand table),
screenshot and axe coverage per route at 360/390/768/1440 in light and dark, how CI time stays within budget, the stop-and-ask list,
and exactly which existing tests change (selectors only). Write for an implementing model that will follow it literally.
