# A third-party architecture review — ChatGPT "Astra," shared 2026-09-27

Chris pasted this from OpenAI's Astra tool, describing itself as reviewing
"the screens" without auditing the backend. Saved verbatim below; see
`docs/DECISIONS.md` for the assessment against what's actually built.

---

I would build Appliance Desk into a complete rental operations system, with the website and customer portal connected to the same business records.

The foundation should support multiple employees, properties, warehouses, and service areas—even while you operate alone. "Ready to scale" should mean growth won't require rebuilding your records or workflows. Actual capacity still needs to be measured and tested.

Based on the screens I reviewed, Claude has a useful starting point. My recommendations concern the system's structure; I haven't audited its backend.

## 1. Organize the business around connected records

The most important design decision is separating these concepts:

| Record | What it represents |
|---|---|
| Customer account | The individual or company responsible for the relationship |
| Contacts | Tenants, property managers, billing contacts, authorized decision-makers |
| Properties and units | Where appliances are installed |
| Catalog products | What you offer, including individual appliances and sets |
| Physical appliances | Each actual machine, with its serial number and history |
| Agreements | Signed terms, prices, responsibilities, and dates |
| Jobs | Deliveries, installations, repairs, swaps, and pickups |
| Financial records | Invoices, payments, deposits, credits, refunds, and outstanding balances |

This lets one property manager have 30 properties, several contacts, different agreements, and either consolidated or property-specific billing.

The payer, occupant, property owner, and service contact must be allowed to be different people.

## 2. Build complete workflows with controlled transitions

Every rental should follow a connected lifecycle:

Inquiry → Quote → Agreement → Equipment reservation → Delivery → Active rental → Service or renewal → Pickup → Inspection → Available again

Each transition needs prerequisites and recorded consequences. For example:
- Signing an agreement does not mean delivery occurred.
- A delivery attempt does not automatically start billing unless the agreement specifies that trigger.
- A pickup request does not automatically stop billing.
- A returned appliance does not become available until inspection.
- A swap preserves the agreement and the history of both machines.

The owner should be able to handle exceptions, with a reason and audit record.

## 3. Give billing its own rigorous subsystem

This deserves more attention than dashboard graphics.

I recommend:
- A permanent transaction ledger, with corrections recorded as adjustments.
- Separate rent, delivery, installation, deposits, tax, credits, and refunds.
- Clear rules for billing start dates, partial periods, renewals, and termination.
- Versioned pricing and agreement amendments.
- Temporary discounts with explicit expiration.
- One-time satisfaction credits that do not change recurring rent.
- Payment allocation across invoices.
- Failed-payment follow-up and dispute tracking.
- Reconciliation between your ledger and the payment processor.
- Accounting exports or integration, rather than trying to build a complete accounting package immediately.

Payment operations must be safe to retry. Stripe supports idempotency keys for requests, which help prevent repeated submissions from performing the same operation twice. Application records also need their own duplicate protections.

## 4. Track appliance profitability throughout its life

For every machine, record:
- Purchase source, date, cost, and receipt.
- Model, serial number, photos, and condition.
- Warehouse/location and current assignment.
- Inspection and refurbishment history.
- Parts, repair labor, and transportation costs.
- Rental income, downtime, and retirement/disposal.

This should answer: "Which machines make money, which need replacement, and what should I buy next?"

A set should connect two physical machines while allowing either machine to be replaced independently.

## 5. Make dispatch and maintenance operationally useful

Build scheduling around real constraints:
- Employee availability and skills.
- Vehicle capacity.
- Job duration and travel buffers.
- Service areas and access restrictions.
- Appliance availability.
- Required parts and installation materials.

Initially, you approve every job manually. Later, customers can choose only slots supported by actual inventory and operating capacity.

Give field staff a mobile workflow with checklists, photos, serial scanning, customer acknowledgment, and completion notes. If offline work is added, distinguish saved-on-device information from successfully synchronized records.

## 6. Support purchasing, supplies, and suppliers

Add purchase orders, receiving, supplier records, parts stock, and reorder thresholds.

Receiving an appliance should create its inventory record. Using a part on a repair should reduce stock and assign the cost to that appliance.

Keep purchasing suggestions separate from actual purchasing approval.

## 7. Design permissions for employees before hiring them

Create roles such as:
- Owner/admin.
- Dispatcher.
- Technician/driver.
- Billing/bookkeeping.
- Sales/customer service.
- Customer/property manager.

A technician needs job details and access notes, but ordinarily not full financial reports or permission to issue refunds.

Enforce permissions on the server and documents, with audit history and stronger approval controls for sensitive actions. PostgreSQL also supports row-level security as an additional data-access safeguard when appropriate.

## 8. Use a practical, scalable technical foundation

My preferred starting architecture is a modular application: one coordinated backend, with clear boundaries between billing, inventory, scheduling, customers, and communications.

Support it with:
- A relational database with enforced relationships and transaction safeguards.
- Private file storage for agreements, photos, and receipts.
- Background workers for reminders, invoices, imports, and notifications.
- Durable queues with retries and a visible failed-task inbox.
- Documented APIs for future integrations.
- Monitoring, error alerts, and audit logs.
- Automated backups and tested restoration.
- Separate development, staging, and production environments.

Avoid splitting everything into separate services prematurely. Split a component when measured load or operational needs justify it.

## 9. Measure business health and system capacity

Your reporting should distinguish:

| Business health | System health |
|---|---|
| Rental income versus collected cash | Payment and background-task failures |
| Appliance utilization and downtime | Response times and error rates |
| Contribution margin by appliance/property | Database load and queue backlog |
| Lead conversion by source and term | Backup and restoration status |
| Overdue balances and cancellations | Scheduling and reservation conflicts |
| Upcoming inventory and staffing needs | Integration delays |

Agree on expected peak volumes, then test beyond those volumes. A claim of "unlimited scalability" is not a substitute for evidence.

I would build this in four releases:
1. Reliable core: records, agreements, inventory, pricing, ledger, manual jobs, permissions, backups.
2. Daily operations: maintenance, purchasing, customer portal, notifications, field workflows.
3. Growth controls: portfolio accounts, staff approvals, multiple locations, reporting, accounting integration.
4. Controlled automation: customer ordering, live scheduling, replenishment suggestions, and route optimization.

My strongest recommendation is to have Claude define the data relationships, lifecycle rules, and financial invariants before adding more screens. Those decisions will determine whether Appliance Desk remains dependable as your business grows.
