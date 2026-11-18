# Domain and data — Appliance Desk

## The domain areas (`src/domains/`)

69 folders (counted at head `08cf314b`, 2026-11-18), one per business
area, plus a shared `pagination.ts`. Grouped here by what they serve:

- **Selling & customers:** `customers`, `leads`, `estimates`,
  `agreements`, `pricing`, `sales`, `referrals`, `growth`, `launch`,
  `site-content`, `preview-storage`.
- **The rental operation:** `inventory`, `jobs`, `delivery`,
  `maintenance`, `orders`, `packages`, `purchasing`, `recalls`,
  `refrigerant`, `vehicle`, `insurance`, `certifications`.
- **Money:** `billing`, `books`, `budget`, `collections`, `disputes`,
  `tax`, `taxben`, `accountant`, `paperwork`.
- **People & access:** `account`, `team`, `staff`, `desk-access`,
  `capabilities`, `approvals`, `security`, `privacy`, `vault`.
- **Talking to customers:** `messaging`, `notifications`, `notices`,
  `portal`, `language`, `feedback`.
- **Running the system itself:** `settings`, `setup`, `connections`,
  `automation`, `backup`, `continuity`, `control-center`,
  `dashboard`, `activity`, `decisions`, `exceptions`, `features`,
  `goals`, `insights`, `reports`, `rules`, `search`, `documents`,
  `stored-files`, `uploads`, `system-issues`, `tasks`, `agent-control`,
  `compliance`, `workspace`.

## The data model (`prisma/schema.prisma`)

243 models and 124 enums (counted from the schema at head `08cf314b`,
2026-11-18). Money is always integer cents; timestamps are UTC and
shown in Mountain Time. The families and how they relate:

```mermaid
flowchart LR
  Customer["Customer<br/>+ ServiceAddress, CustomerNote,<br/>CustomerContact, ConsentRecord"]
  Lead["Lead → LeadNote,<br/>LeadApplianceRequest"]
  Agreement["RentalAgreement<br/>→ RentalLine → Appliance<br/>signing charges, deposits,<br/>amendments, early returns"]
  Inventory["Appliance<br/>+ ApplianceType, inspections,<br/>custody episodes, assignments<br/>PartRecord · Supplier · PurchaseOrder"]
  Job["Job<br/>delivery / install / swap /<br/>maintenance / removal<br/>+ JobAppliance, handoffs"]
  Invoice["Invoice → InvoiceLineItem<br/>Payment · Refund · Receipt<br/>CustomerCredit · collections"]
  Books["Books (double-entry)<br/>LedgerAccount → JournalEntry → JournalLine<br/>bank imports & matching · budgets · expenses"]
  Tax["Tax rule book<br/>TaxJurisdiction · TaxRateVersion<br/>TaxabilityRule · InvoiceTaxLine · filings"]

  Lead -->|"converts to"| Customer
  Customer --> Agreement
  Agreement --> Inventory
  Agreement --> Job
  Job --> Invoice
  Customer --> Invoice
  Invoice --> Books
  Invoice --> Tax
```

- **Auth & people (Better Auth):** `User`, `Session`, `Account`,
  `Verification`, `RateLimit`, `TwoFactor`, `KnownDevice`, plus
  `JobRole`, `TeamInvitation`, `StaffCapabilityOverride` for what
  each person may do, and `StaffTask` for assigned work.
- **Customers & leads:** `Customer` (with the maintained
  `owedCents` total), `ServiceAddress`, `Referral`,
  `LocationPortfolioImport` / `LocationContact` for multi-location
  customers, `Lead` pipeline, language-review and translation-draft
  models for customer wording.
- **Inventory & purchasing:** `ApplianceType`, `RentalPackage` (+
  components), `Appliance` with inspections, amendments, custody
  episodes and assignments; `PartRecord`, `PartStockMovement`,
  `Supplier`, `PurchaseOrder` (+ lines, receipts, receipt tax),
  `Purchase` documents and use tax.
- **Agreements & signing:** `RentalAgreement` and `RentalLine` (+
  amendments), the signing-money chain (`AgreementSigningCharge`,
  `AgreementSigningPayment`, `SigningDownPaymentCredit`,
  `SigningFirstInvoiceApplication`, `SigningPaymentAttempt`),
  setup-fee tax decisions, `PricingRule`, `Deposit`,
  `SignatureRecord`, renewals, early-return and pre-delivery
  cancellation records.
- **Jobs & maintenance:** `Job` (+ `JobAppliance`,
  `JobBillingHandoff`, `PendingDelivery`), `MaintenanceRequest`,
  `Estimate` (+ lines).
- **Billing & payments:** `Invoice` (+ lines and tax lines),
  `Payment`, `Refund`, `Receipt`, `PendingCharge`,
  `BankPaymentInFlight`, `CustomerCredit`, `CreditApplication`,
  `WebhookEvent`, `PaymentDispute`, and collections
  (`CollectionStep`, `CollectionCase`, `SmallClaimsFiling`).
- **Tax & compliance:** `TaxJurisdiction`, `TaxRateVersion`,
  `TaxRateObservation`, `TaxabilityRule` (+ versions),
  `LegalRuleVersion`, `OfficialSourceWatch`,
  `LegalRuleObservation`, address→jurisdiction mapping and
  readiness, `InvoiceTaxLine`, `TaxFilingPeriod`,
  retail-delivery-fee models, `ComplianceProfile`,
  `ComplianceFiling`, `TaxYearFacts`, W-9 requests.
- **Books:** `LedgerAccount`, `JournalEntry` / `JournalLine`,
  `AccountingPeriod`, Stripe balance transactions,
  `Expense` / `RecurringExpense`, `BookAsset`, bank side
  (`CashAccount`, `BankImport`, `BankObservation`, match groups and
  items, `BankReconciliation`, `CashHold`, `BookCashEvent`),
  export batches and account export mappings, and the `Budget*`
  family (plan versions, envelopes, moves, targets, cost plans).
- **Communications / telecom:** `TelecomAccount`,
  `BusinessPhoneNumber`, contact points and bindings,
  `CommunicationThread` / `CommunicationMessage`, `MessageAttempt`,
  `MessageDelivery`, `CallSession` / `CallLeg`, media, templates,
  sync cursors, usage snapshots, cost facts, rate versions and
  statements; plus `ProviderEvent` and `MarketingSuppression`.
- **Platform & operations:** `BusinessSettings`, site content
  (revisions, pointers, assets), launch settings/subscribers,
  `AutomationRun`, `AuditLog`, `SystemIssue` (+ notes),
  `BackupArtifact`, `Photo`, `DocumentArtifact`, business paperwork
  and record files, the credential `Vault*` models and
  `EmergencyAccessRequest`, goals, feedback cases, recall matching,
  safety incidents, insurance policies, fleet vehicles and mileage,
  team certifications, refrigerant records, decisions
  (`DecisionRecord`), notifications and preferences.
- **Assistant connection (MCP/OAuth):** `Jwks`, the `Oauth*` family
  (clients, resources, tokens, consents, assertions),
  `McpConnection`, `AgentPass`, `AgentResult`, `AgentOperation`,
  `OpsAgentKey`, and monitoring (`PerfSample`,
  `OptimizationProposal`, `MonitorRule`, `MonitorRun`,
  `RepairCase`).

## Migrations — read this before trusting a count

`prisma/migrations/` holds 57 folders at head `08cf314b`
(2026-11-18), the newest dated 2026-10-05
(`20261005010000_remediation_r2_deposit_provenance`). The schema
names 243 models, and several of them — `AgentOperation` and the
`Customer.owedCents` column are visible examples — are described in
`docs/DATABASE.md`'s dated changelog under migration names that have
no folder on `main`. In other words, on `main` the schema and
`docs/DATABASE.md` run ahead of the migration folders; the repo's
own `check:migrations` script (run by every `vercel-build`) is the
arbiter of whether that gap is safe, and anyone adding a model here
should expect to answer for it there.
