# Private AI check-up — manual setup and safety

The System health page at `/desk/automations` lets the OWNER create an AI check-up key (shown once) and revoke it. Keep the token in the agent's private credential store only. Never commit it, paste it into an issue, log it, or include it in a public PR. The setup decision in OWNER-INPUTS (IN-45) remains required; no schedule or paid service is enabled automatically.

To verify a key, send a GET request to `/api/ops/issues?limit=25` with `Authorization: Bearer <privately-stored-key>`. The API returns a bounded, typed list of issue IDs, kind, severity, status, version, summary, safe detail, count and timestamps; it does not expose owner notes, personal details, raw provider errors, or key hashes. A missing/revoked key returns 404; a rate-limited key returns 429; responses are not cached.

## Hand-off block and discovery document (OPS-HANDOFF-1)

An assistant does not need this repository to use a key. When the owner creates a key, the panel shows a **hand-off block** alongside it: the key, the address of the deployment the key was created on, and a plain briefing (where to call, the Bearer header, what a check-up is, the three note categories, the fixed recommendations, the 60-requests-per-hour limit, the error answers, and what the data deliberately excludes). The owner copies the whole block and pastes it to the assistant; key + one paste is the whole setup. The block is shown once, with the key, and is gone after a reload.

An assistant that has lost the briefing can re-learn the contract at any time from the **keyless discovery document**: `GET /api/ops` on the same address needs no key and returns the same contract as JSON, written for the deployment it is fetched from. It contains no issue data and no key material, answers identically with or without a key, and grants nothing — the key stays the only credential.

The contract has one source: `src/domains/system-issues/ops-contract.ts`. `ops-api.ts` enforces the constants from that module and the panel/discovery publish them, so what an assistant is told can never drift from what the API does.

## Routine prompt (for a user-authorized scheduled agent)

Read the current repository AGENTS.md and authoritative roadmap. Read the safe typed issues from GET /api/ops/issues, paginating only when necessary. Diagnose newly discovered or updated issues without accessing customer/private data. For each issue:
1. If OWNER_ACTION, identify the owner's next manual step; never change prices, settings, payments, messaging, or customer data without approval.
2. If CODE_FINDING, reproduce with targeted tests and relevant CI drift checks. Propose a reviewed PR with complete tests; **do not merge unattended**.
3. If QUESTION, record only the verified uncertainty and the specific evidence needed.

To annotate an issue use POST /api/ops/issues/{id}/notes with **only** category (`OWNER_ACTION`, `CODE_FINDING`, `QUESTION`), codeReferences (existing repository file paths), recommendationKey (`INVESTIGATE_CODE`, `OWNER_CONFIGURATION`, `VERIFY_PROVIDER`, `REVIEW_SOURCE`), expectedVersion, and optional same-repository GitHub PR URL. Free-text notes and arbitrary URLs are deliberately forbidden.

If the issue changed, re-read it and retry only when safe. Never claim resolution based solely on an AI note. Report concise verified findings to the owner. Do not enable live payments, SMS/email, external providers, paid services or unattended merges. Prefer a manual review over a speculative fix.
