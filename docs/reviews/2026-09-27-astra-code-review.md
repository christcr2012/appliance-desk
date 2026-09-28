# A fourth Astra message — an actual code review of `main` at commit 872b980

Unlike the three earlier reviews this session, this one wasn't just a
pitch based on the screens — it says it read the real repository at a
specific commit and reports concrete, line-level findings in the billing
and agreement-lifecycle code. Saved verbatim below; see
`docs/DECISIONS.md` for what I found when I checked each claim against
the actual code and what I fixed as a result.

---

I reviewed the repository, and Appliance Desk is more developed than the earlier screens suggested—but I found important gaps between having features and having reliable, connected workflows.
I reviewed main at commit 872b980. This was a code review; I did not change your repository, run payments, or execute the test suite. The matching automated check was still running when checked.
What you already have—and should preserve
The code includes:
- Customer creation with multiple service addresses.
- Agreements, signatures, pricing snapshots, and equipment reservations.
- Database-enforced checks to prevent competing reservations from assigning the same available appliance.
- Stripe Checkout, customer billing portal, and payment-event handling.
- Maintenance requests linked to jobs.
- Appliance QR labels, repair costs, fleet analytics, and revenue reporting.
- Activity logging and automated tests.
My earlier recommendations included some capabilities Claude has now added. I would improve this application incrementally, not rebuild it.
The first improvements should address these specific findings
Priority	Finding in the code	Business consequence
Urgent	A successful-payment handler skips an invoice if that invoice already exists—even if it was previously marked delinquent	A customer who successfully pays after a failure can still appear unpaid
Urgent	Checkout completion is recorded as a successful payment without checking whether payment actually settled	Pending bank payments can appear paid
Urgent	Ending/cancelling an agreement updates local records but does not stop its Stripe subscription in the reviewed action path	Billing can continue after you consider the rental ended
High	Closing an agreement immediately makes its appliances available	Equipment still at a customer’s property can become assignable again
High	Signing immediately starts the agreement and marks appliances rented	Signature, delivery, and actual rental commencement are conflated
High	Checkout creation has no saved-session reuse or explicit idempotency key; webhook processing checks and records completion separately	Retries and overlapping requests need stronger protection


The first two findings are in payment-event handling. Stripe distinguishes Checkout completion from later success for delayed payment methods such as ACH. Stripe Documentation
The lifecycle findings are in agreement handling and its owner actions. These are code-path findings, not claims that a real customer has already been affected.
Where the software needs more depth
1. Separate agreement, equipment, and billing status.
A signed agreement, delivered appliance, and paid invoice are three separate facts. Build explicit transitions between them, including returned-but-awaiting-inspection equipment and billing changes awaiting confirmation.
2. Expand customer accounts beyond one login.
The current customer model requires one unique user account. Multiple addresses exist, but a property manager needs several authorized contacts: billing staff, maintenance coordinators, and property contacts, potentially with different access.
3. Turn Jobs into dispatch software.
The current job model has a scheduled time, but no assigned technician, duration, vehicle, or capacity model. Add those alongside rescheduling, conflict detection, checklists, and completion evidence. Keep your manual approval requirement.
4. Add a central exception queue.
Show signed-but-unpaid agreements, failed payment synchronization, deliveries lacking equipment, overdue service requests, and returned appliances awaiting inspection. Each issue should have a clear resolution action.
5. Make reports distinguish estimates from actual results.
Current appliance earnings are estimated from assignment duration using 30-day months. Assignments begin during reservation, so this can include time before a rental starts. Missing acquisition costs are treated as zero.
Keep those estimates, but separate them from invoiced rent, collected rent, refunds, and missing-cost warnings. The relevant logic is in inventory analytics.
6. Prepare lists and background work for growth.
The reviewed customer, agreement, job, and invoice list functions retrieve all matching records. Add server-side pagination, search, date ranges, and selective loading. Introduce durable background processing for notifications and integration retries, with visible failures.
The implementation order I recommend
1. Billing correctness: failed-to-paid recovery, pending bank payments, duplicate/reordered events, and agreement-ending billing reconciliation.
2. Rental lifecycle: separate signing, delivery, billing start, pickup, inspection, and availability.
3. Connected workspaces: customer overview, guided rental builder, appliance history, dispatch board, and exception queue.
4. Staff and portfolio support: multiple contacts, narrower employee permissions, property views, and consolidated billing.
5. Scale verification: realistic data volumes, concurrent actions, recovery testing, monitoring, and tested backups.
The existing payment tests cover initial payment recording, sequential duplicate delivery, and payment failure. They do not establish that failure followed by success, delayed settlement, concurrent delivery, or partial-processing recovery works.
My recommendation to Claude would be: “Start with a reliability release, then expand the operational workspace.” That will make the software materially stronger while protecting the substantial work already built.
