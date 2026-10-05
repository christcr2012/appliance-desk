# Settings coverage — every `BusinessSettings` column has one disposition

Written 2026-10-06 (Batch D, WU-D1/D4) by reading `prisma/schema.prisma` model `BusinessSettings` line by line.
Dispositions: **editable (section)** = the owner changes it in Desk → Settings; **read-only (where)** = shown but not
editable; **deprecated** = nothing reads it (kept in the database; dropped in a later cleanup, never silently).

| Column | Disposition |
|---|---|
| `id` | internal key (`singleton`) |
| `publicBusinessName`, `publicPhone`, `publicEmail`, `publicAddress` | editable (Business profile) |
| `serviceAreaCities`, `serviceAreaZips` | editable (Service area) |
| `hours`, `holidayClosures`, `socialLinks`, `logoUrl` | editable (Business profile) — made editable and shown on the public footer and contact page in Batch D |
| `oneTimeDeliveryFeeCents`, `oneTimeInstallationFeeCents`, `oneTimeRemovalFeeCents`, `damageWaiverEnabled`, `depositEnabled` | editable (Rental policies) |
| `defaultJobDurationMinutes`, `staffMayWorkUnassignedJobs` | editable (Visits and scheduling) |
| `lateFeeGraceDays`, `lateFeeFlatCents`, `lateFeePercent` | editable (Rental policies) |
| `taxRateMilliPercent`, `taxRateConfirmed` | editable (Rental policies); the exact tax rate |
| `taxRatePermille` | deprecated (replaced by `taxRateMilliPercent`; kept in step by a database rule) |
| `announcementBannerText`, `announcementBannerOn` | deprecated (no reader) |
| `sixMonthPrepay…`, `twelveMonthPrepay…` (five discount columns) | editable (Rental policies) |
| `referralRewardCents` | editable (Rental policies) |
| `customerEmailEnabled` | editable (Notifications; owner only; OFF by default) |
| `autoRenewEnabled` | editable (Ending and renewing rentals; owner only; OFF by default) |
| `draftReservationHoldDays` | editable (Rental policies) |
| `inspectionChecklist` | deprecated (Batch C moved checklists to `InspectionChecklistVersion`; edited in Rental policies) |
| `earlyTermination…` (fee cents, percent, cap, notice days), `unusedTermTreatment`, `terminationTermsText` | editable (Ending and renewing rentals) |
| `autoRenewNoticeDays`, `autoRenewTermsVersion`, `renewalTermsText` | editable (Ending and renewing rentals); version is derived |
| `noticeCertifierRoles`, `mailNoticeTransitDays` | editable (Ending and renewing rentals; owner only) |
| `monthToMonthChangeNoticeDays`, `termsChangeNoticeText`, `annualReminderText` | editable (Ending and renewing rentals) |
| `earlyReturnBilling`, `earlyReturnUnusedDays`, `earlyReturnFee`, `earlyReturnHandling`, `earlyReturnProrationBasis` | editable (Ending and renewing rentals → When equipment comes back early) |
| `lateReturnRateMode`, `lateReturnFixedDailyCents`, `lateDeliveryProrationBasis`, `pickupDayNotBilled` | editable (Pickups and deliveries) |
| `legalApprovals` | editable (Rental policies → Legal page approval; owner only) — Batch D |
| `updatedAt` | internal |
