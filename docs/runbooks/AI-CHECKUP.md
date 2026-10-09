# Private AI check-up — manual setup and safety

The System health page at `/desk/automations` lets the OWNER create an AI check-up key (shown once) and revoke it. Keep the token in the agent's private credential store only. Never commit it, paste it into an issue, log it, or include it in a public PR. The setup decision in OWNER-INPUTS (IN-45) remains required; no schedule or paid service is enabled automatically.

To verify a key, send a GET request to `/api/ops/issues?limit=25` with `Authorization: Bearer <privately-stored-key>`. The API returns a bounded, typed list of issue IDs, kind, severity, status, version, summary, safe detail, count and timestamps; it does not expose owner notes, personal details, raw provider errors, or key hashes. A missing/revoked key returns 404; a rate-limited key returns 429; responses are not cached.

## Routine prompt (for a user-authorized scheduled agent)

Read the current repository AGENTS.md and authoritative roadmap. Read the safe typed issues from GET /api/ops/issues, paginating only when necessary. Diagnose newly discovered or updated issues without accessing customer/private data. For each issue:
1. If OWNER_ACTION, identify the owner's next manual step; never change prices, settings, payments, messaging, or customer data without approval.
2. If CODE_FINDING, reproduce with targeted tests and relevant CI drift checks. Propose a reviewed PR with complete tests; **do not merge unattended**.
3. If QUESTION, record only the verified uncertainty and the specific evidence needed.

To annotate an issue use POST /api/ops/issues/{id}/notes with **only** category (`OWNER_ACTION`, `CODE_FINDING`, `QUESTION`), codeReferences (existing repository file paths), recommendationKey (`INVESTIGATE_CODE`, `OWNER_CONFIGURATION`, `VERIFY_PROVIDER`, `REVIEW_SOURCE`), expectedVersion, and optional same-repository GitHub PR URL. Free-text notes and arbitrary URLs are deliberately forbidden.

If the issue changed, re-read it and retry only when safe. Never claim resolution based solely on an AI note. Report concise verified findings to the owner. Do not enable live payments, SMS/email, external providers, paid services or unattended merges. Prefer a manual review over a speculative fix.
