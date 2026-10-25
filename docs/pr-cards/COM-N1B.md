# COM-N1B — Job and maintenance text messages

Design: [docs/designs/BATCH-COM.md](../designs/BATCH-COM.md). Builds on COM-N1A (same gates). Migration: none. Everything ships **OFF**.

## What it delivers
Preview-then-send boxes on the job and maintenance-request screens:
- job: "Your visit is scheduled", "Reminder of your visit", "We are on the way", "Your visit is done"
- maintenance request: "We got your maintenance request", "Your maintenance request is resolved"

Wording never includes the street address. The visit time is shown in Colorado time.

## Who can send
- Owner / Admin: all six.
- Assigned STAFF: only the four visit texts, only for a job assigned to them (design: fixed templates for assigned-job
  context only). Re-checked when previewing, preparing and dispatching; reassigning the job stops the send.
  Staff cannot record customer permission ("ask the office"), cannot see other jobs' texts, cannot send maintenance texts.
- Customers: never.

## Fit rules (plain-words reasons on screen)
scheduled/reminder need an upcoming, not cancelled/done visit; on-the-way needs a visit scheduled for today; done needs a
completed visit; received needs an open request; resolved needs a resolved/closed request. A job with no customer cannot be texted.

## Gates
Same as COM-N1A (master switch, phone setup, per-kind switch, Owner-approved wording, recorded permission, STOP, quiet hours,
last-moment re-check). Texts are not legal notices.

## Acceptance → evidence
`tests/com-n1b-workflow-integration.test.ts` (throwaway Postgres, fake carrier): assigned-staff preview/limits, unassigned staff
and customers refused, permission then one text filed on the job, reassignment refused, state fit rules, owner maintenance text,
off-by-default kinds, no-customer job. N1A tests still pass.
