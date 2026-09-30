# Daily workspace implementation

2026-09-30. Implements shared presentation/navigation and Today/task-list work.
CI and preview acceptance are tracked in the PR; implementation is not release evidence.

## Components and semantic colors

`src/components/desk/workspace.tsx` supplies PageHeader, SectionCard, EmptyState,
FilterBar and Metric. Each is used in Today or Tasks; queries remain in the
server page/domain. Existing Pagination and TaskRow are reused. Filters are
links with URL state, so refresh and browser history preserve the selection.

New tokens extend Evergreen without removing legacy compatibility overrides:

| Pair | Light | Dark | Tested minimum |
|---|---|---|---|
| action / on-action | #123c2d / #ffffff | #b9e66b / #123c2d | 4.5:1 |
| subtle / ink-soft | #f7f5ec / #4e6658 | #0c1e16 / #b7c8bb | 4.5:1 |
| control / surface | #4e6658 / #ffffff | #789985 / #152e22 | 3:1 |

The contrast test reads actual CSS values. Page titles use 28/36, section
headings 18/28, normal body 16/24 and dense operational content 14/20.
Cards use radius 12, controls radius 8, and a minimum 44px touch target.

## Calendar contract

Job timestamps are instants shown in America/Denver. Each day's two midnight
boundaries are resolved independently, preserving spring/fall DST transitions.
Task input is a date-only value stored as UTC midnight by the existing action;
it is rendered as that date, never converted to the viewer's previous evening.
A deadline remains due today until the Colorado calendar advances. There is no
backfill or reinterpretation of job schedule writes in this batch; dispatch
scheduling input/timezone unification remains part of the job contract work.

## Queries and permissions

Navigation is filtered on the server before serialization. Existing page,
action, export and domain guards remain authoritative. Today request counts
include SUBMITTED/REVIEWING/SCHEDULED/IN_PROGRESS, not RESOLVED/CLOSED.
Jobs remaining includes SCHEDULED/IN_PROGRESS, not COMPLETED/CANCELLED.
Tasks remain shared among authorized desk roles. Task rows are bounded to 25;
Today fetches six with separate full counts. Stable due-date/createdAt/id
ordering and null dates last preserve consistent pagination.

## Acceptance and remaining work

New browser tests exercise modal focus/Escape/internal scrolling for both
owner and staff, task persistence, and Today/Tasks light/dark at 360/768/1440.
Screenshots are attached to the existing Playwright report. Manual visual and
screen-reader checks remain explicit; screenshots alone are not an approval.
Task assignment/priority, customer record tabs, lead workbench, private preview
storage and hosted isolation proof remain separate work. Existing exception
aggregation and daily schedule queries are not a measured capacity benchmark.
