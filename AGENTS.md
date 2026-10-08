# AGENTS.md — the rules. Read this first, every session.

This file is the single, current set of rules for every AI system working on
this repo (ChatGPT/Codex "Sol", Claude, Copilot, or any other). It is
written to be followed literally. There are no "superseded" layers in it: if
something is written here, it is current. History and the reasons behind
decisions live in `docs/DECISIONS.md` and `docs/archive/` — those are for
looking things up, never for instructions. The repo — not chat history — is
the memory: if it isn't written down here or in `docs/`, the next session
won't know it.

Reading order once per session; refresh only changed sections:

1. This file.
2. `docs/START-HERE.md` — what the project is, where everything lives.
3. `docs/STATUS.md` — exactly where work stands right now and what is next.
   Then `docs/MASTER-ROADMAP.md` — the one ordered list of every remaining step, what
   must be true before each starts, and what only Chris can do.
4. `docs/PLAN.md` — the section for the batch you are working on.
5. Your PR's card in `docs/pr-cards/` if it has one, then only the design sections it names in
   `docs/designs/BATCH-<X>.md` (find them with `grep -n "^## \|^### "`; never read a large design top to bottom).
6. `docs/PLAYBOOK.md` — the step-by-step procedure for doing a batch.

Then open only the reference docs the batch section names. Do not read
`docs/DECISIONS.md`, `docs/archive/`, or the audit reports end to end — search
them when a sp���q�^