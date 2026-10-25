# COM-N3 — Verified phone-company statement → books expense (merged, #555)

Design: [docs/designs/BATCH-COM.md](../designs/BATCH-COM.md). Record written afterwards so the index points at a real card.

## What it delivers
An Owner/Admin can book a **verified** private provider statement as one expense in the books: the statement links to exactly one existing
expense (or creates one once), usage, top-ups and the invoice are never posted twice, and a correction uses the normal void path.
Nothing is posted automatically.

## Evidence
`tests/telecom-statement-books-integration.test.ts` (throwaway Postgres): duplicate/concurrent booking, manual bill already booked, integer cents, and re-booking a corrected statement after the original expense is voided.

## Known gaps (recorded, not blocking)
- A correction in an already-closed accounting period is not separately tested.
- No browser test of the booking form yet (needs a verified-statement fixture in the browser database).
