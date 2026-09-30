# Low-cost implementation guide and paste-ready prompt

## Model recommendation — verified 2026-09-30

Use **GPT-6 Luna with High reasoning** for the tightly scoped L cards.
Use **GPT-6.1 Sol** for S cards and security/payment/migration review, starting
at the default/Medium setting and using High for difficult concurrency work.
If choosing only one model, choose GPT-6.1 Sol for the whole implementation:
a failed cheap attempt can cost more than a correct stronger attempt.
These assignments are engineering judgment, not a benchmark of this repository.

Official sources checked:
- https://learn.chatgpt.com/docs/models — Sol for complex coding/agentic work,
  Luna for focused repeatable work; recommends High for Luna; availability
  depends on account/client. GPT-5.4 Mini retired from Codex ChatGPT sign-in
  on August 31, 2026, so it is not the recommended Codex choice here.
- https://developers.openai.com/api/docs/models — current standard API list
  shows Luna $0.10 input/$0.50 output and Sol6.1 $2 input/$10 output per 1M
  tokens. This is API token pricing, NOT a quote for ChatGPT Plus usage,
  Work credits, tool calls, reasoning totals, hosting, or the completed project.

Do not buy another subscription before checking the user's existing model
picker. Start with O03/O04 as the first representative Luna UI tasks after
O00 and the necessary foundations. Compare accepted PR cost/rework, not raw
output speed. No fixed dollar or completion-time promise is justified yet.

## Keep it cheap without reducing the required quality

1. One card/subcard at a time. Load AGENTS, HANDOFF tail, the relevant DESIGN
   section, that card and named files/tests. Search before loading giant docs.
2. Reuse existing domain actions/components. Do not spend tokens rebuilding
   a CRM that already exists or rewriting intact files for cosmetic changes.
3. Request a <=8-line understanding/acceptance summary, then implementation.
   No repeated essays or exhaustive unrelated repository rescans.
4. Split a data contract from its UI. Sol produces reviewed schema/actions;
   Luna implements the narrow presentation against that contract.
5. Run targeted tests while iterating, then the required full CI once the
   slice is ready. Rerun failed checks for a concrete reason; don't add tests
   that only repeat trivial markup. Never skip required CI to save tokens.
6. After two unsuccessful fixes of the SAME failure, stop speculative edits
   and hand the error, attempted fixes and diff to Sol. This is a model
   escalation, not permission to abandon the task or weaken assertions.
7. No parallel agents or overlapping file edits unless explicitly authorized.
8. Update task status and HANDOFF with exact evidence once. Stop/report at
   each release boundary as AGENTS requires. Keep unblocked work moving when
   an owner input only affects future activation.

## Paste into a coding session

```text
Work only in christcr2012/appliance-desk. Implement task [TASK_ID] from
 docs/plans/overhaul/TASKS.md. Use the matching section of DESIGN.md.

Read AGENTS.md and the latest docs/HANDOFF.md first. Check current branch,
main, open PRs and docs/OWNER-INPUTS.md. Do not overwrite another agent's
work. PR #86 may still be pending; verify before assuming launch code exists.

This is an incremental improvement, not a rewrite. Preserve the Evergreen
brand, existing domain actions, role checks, rental lifecycle, financial
rules and working tests. Follow the installed Next.js version's bundled
documentation before editing framework code. Reuse current components.

Before changing code, state the scoped outcome and acceptance checks in
at most8 lines. Implement only this task or its explicitly named subcard.
If another prerequisite is missing, record it rather than silently building
a second feature. Use a branch ai/<tool>/overhaul-[TASK_ID]; never commit main.

A data-changing preview must be isolated from production at build AND
runtime. Never run fixtures/reset scripts against the shared production DB.
No fake data, placeholder logic, fake success, customer messages, live payment
activation, purchased services or destructive data changes.

Test real behavior, relevant permissions and failure/concurrency cases.
Run the required type/lint/test/build/accessibility CI gates and get a preview.
For UI, check 360/768/1440px, keyboard and light/dark mode. Check the whole
changed flow, not just a render. Do not disable existing tests to pass.

Update HANDOFF and the task ledger with files, verified commit, CI/preview,
what is incomplete and any owner-input IDs. Open a PR. Do not auto-merge or
start the next release. Report in plain English: what changed, how verified,
what Chris needs to review, and the next eligible task. If the same failure
survives two focused fixes, hand off the evidence for Sol review.
```

Replace `[TASK_ID]` with one real card, such as O03. The bracketed value is a
prompt parameter, not an application placeholder. Start with O00 when adopting
the plan; do not skip environment/security gates just to start visible UI.

## Reviewer prompt (Sol)

```text
Review this task's diff against AGENTS.md, its TASKS.md acceptance criteria,
and the relevant business rules. Check regressions, role/data isolation,
financial/inventory invariants, error states, accessibility, migration and
preview safety. Cite concrete file locations. Do not redesign or add scope.
Fix verified defects within the card; otherwise report no blocking findings
and the evidence still required. Approval does not merge or enable services.
```
