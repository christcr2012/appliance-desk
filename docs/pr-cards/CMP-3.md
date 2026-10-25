# CMP-3 — 1099s and W-9s (and Form 8300)

Build spec: `docs/build-specs/engines/COMPLIANCE.md` CMP-3. Depends on CMP-1. Risk: **vendor tax ids, a public
upload page, filing with the IRS** (IRIS A2A off until Chris has the TCC).

## Acceptance
- [ ] W-9 request and one-time upload page (rate limited, single use); TINs encrypted, last 4 only on screen.
- [ ] Paying a 1099 vendor without a W-9 raises a To do with the 24% backup-withholding warning.
- [ ] 1099-NEC/MISC amounts by year and box, card payments excluded, dated threshold; IRIS CSV matches the IRS template header.
- [ ] Recipient copies filled from the official PDFs; A2A client tested against the schema with fixtures, behind its switch.
- [ ] Cash over $10,000 (alone or related, 12 months) → Form 8300 To do with a filled form; `ci` green; every review comment read.

## Owner checklist
"Get an IRIS TCC (Taxpayer Portal) — and later an A2A TCC" with steps. Never blocks merging.

## Progress
Not started.
