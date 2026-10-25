# MCP-10a — App feedback box (people only)

Build spec: `docs/build-specs/engines/FEEDBACK.md`. Design: `docs/mcp/FEEDBACK.md`. Approved by Chris 2026-10-25
("Human part first"). Depends on nothing (uses AR-0a kit parts if merged). Risk: **a form open to signed-in customers
with picture uploads; privacy deletion**. Read `docs/AI-PR-READ-FIRST.md`.

## Why
Chris wants owners, staff and customers to report app problems and suggest improvements from inside the app, and to
answer them there. AI reading of reports comes later (MCP-11) and only with each reporter's permission.

## One PR
Reports, screenshots, triage and privacy are one feature; shipping the form without privacy deletion or triage would
collect data nobody can manage.

## Acceptance
- [ ] Customer, staff and owner can send a report (with up to the set number of screenshots) and see "My reports".
- [ ] Double click sends one report; rate limit works.
- [ ] Customer B and staff can't open, change or download another person's report by any URL or id (tests).
- [ ] Screenshots: only real PNG/JPEG/WebP, size and pixel limits, location data removed, stored privately.
- [ ] Owner/admin triage: reply, note, status changes with reasons, duplicates; To do shows new and answered reports.
- [ ] Privacy export and deletion cover reports, replies and screenshots.
- [ ] No AI or ops route can reach report content (test).
- [ ] The words never mix up app feedback with appliance repairs.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
