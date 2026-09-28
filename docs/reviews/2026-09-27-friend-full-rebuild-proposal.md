# A friend's "complete rebuild" proposal — Chris shared 2026-09-27

Pasted verbatim by Chris, from a friend who evaluated the project and
proposed rebuilding it as "a complete operating platform" (mobile-first
public site + staff workspace, Postgres-backed, Clerk-based staff
login, inquiry-only public flow with no payment/e-sign/booking yet,
"rental-conversion, portal, and QR-workflow" flagged as follow-up
work).

See `docs/DECISIONS.md` (2026-09-27) for the assessment: most of what's
described already exists and works in this app today; a few pieces are
genuinely new and worth considering on their own, incrementally — not
as a full rebuild. The proposal's mention of "Clerk" for staff login
doesn't match this app (it uses Better Auth), which is one signal this
write-up wasn't based on a look at the actual running system.

---

It should include a mobile-first public site with live catalog
pricing, ZIP checks, rental inquiries, and service requests. The
protected staff workspace has lead follow-up, customer and appliance
records, service and delivery queues, editable prices, and live
operational metrics. Prices and inquiries are stored in PostgreSQL.

This is an inquiry flow, not paid checkout. It does not collect
payment, sign an agreement, reserve an appliance, or book delivery.
The initial service ZIP list needs business confirmation before
publishing. Staff access requires a Clerk account with a verified
email matching Robinson's published contact; the published app will
have a separate production account. There's a few remaining tasks,
rental-conversion, portal, and QR-workflow work as follow-ups.

The goal would be to rebuild Robinson Appliance Rentals into a modern
website that also runs most of the day-to-day rental operation from
one system.

## Customer Website

Completely redesigned, modern mobile-friendly website. Clear washer,
dryer, and washer/dryer package pricing. Online "Rent Now" process.
Address/service-area checker. Customer chooses appliance(s) and rental
term. Property/access information collected before delivery. Online
rental agreement and electronic signature. Online payment setup and
recurring monthly billing. Customer chooses available delivery
date/time. Automatic email/text confirmations and reminders.

## Customer Portal

Every customer would have their own account where they can: see their
current washer/dryer rental; see monthly payment and next payment
date; update their payment method; view payment history and receipts;
view/download their rental agreement; request appliance service;
request a replacement; request appliance pickup; request an address
transfer; see upcoming delivery/service appointments; contact
Robinson.

## Appliance Inventory System

Every washer and dryer would have its own permanent digital record
including: unique appliance/unit number; brand, model and serial
number; purchase date and purchase cost; photos and condition; current
status; current customer; current location; complete rental history;
complete service/repair history; lifetime revenue generated; lifetime
repair costs.

Statuses could include Available, Reserved, Rented, Delivery
Scheduled, Repair, Cleaning, Inspection Needed, Retired, etc.

## QR Codes on Every Washer & Dryer

Every physical appliance would receive its own unique QR code.
Robinson employees could scan the QR code with their phone and
immediately see: which machine it is; serial/model information; who
currently has it; where it's located; current rental; service history;
rental history; revenue generated; repair costs.

Employees could also scan appliances during delivery and pickup to
make sure the correct machines are assigned to the correct customer.
Customers could scan the QR code on their appliance and quickly submit
a service request without needing to figure out the model or serial
number.

## Delivery & Pickup Management

Delivery calendar; pickup calendar; available delivery windows;
customer address and access instructions; assign appliances to
deliveries; assign drivers; delivery status tracking; QR scan during
delivery; QR scan during pickup; appliance condition/photos upon
return; delivery and pickup history.

## Service & Repair Management

Customers could submit service requests directly online. Robinson
could track: problem reported; appliance involved; technician;
appointment; photos/videos; parts required; labor cost; parts cost;
repair status; complete repair history.

Every repair expense would automatically be tied back to that
individual appliance.

## Customer Management / CRM

One customer profile would contain: contact information; address;
current rentals; previous rentals; assigned appliances; payment
history; agreements; service history; delivery history; notes;
messages; complete customer activity timeline.

## Recurring Billing & Payment Management

Automatic monthly payments; credit/debit card payments; payment
history; failed payment tracking; past-due accounts; credits/refunds;
discounts/promotions; automatic payment reminders.

## MRR & Financial Dashboard

The owner would have a dashboard showing: Monthly Recurring Revenue
(MRR); Annualized Recurring Revenue (ARR); actual collected revenue;
active rentals; active customers; new rentals; cancellations; customer
churn; past-due revenue; failed payments; MRR growth over time.

## Appliance Profitability & ROI

One of the biggest features would be knowing exactly how profitable
every individual machine is. For example:

Washer W-0047 — Purchase Cost: $310; Lifetime Rental Revenue: $1,085;
Repair Costs: $92; Net Contribution: $683; Months Rented: 31; Current
Status: Rented.

The system could track: purchase cost; revenue generated; repair
expenses; net contribution; utilization; payback progress; date the
appliance paid for itself; days rented vs. sitting idle.

## Fleet Analytics

Across all washers and dryers, the owner could see: total number of
appliances; how many are currently rented; how many are available; how
many are being repaired; overall inventory utilization %; total amount
invested into appliances; total lifetime rental revenue; total repair
costs; average payback time; most/least utilized machines;
highest-repair-cost machines.

## Lead Management

Potential customers who don't immediately rent would still be
captured. Track: new leads; contacted leads; rental started; agreement
sent; completed rentals; lost leads; lead source; conversion rates.
This would also show which marketing sources are actually producing
paying customers.

## Property Manager System

A separate section could be built for apartment complexes and property
management companies. Track: property management company; individual
properties; buildings/units; appliances installed at each unit; rental
pricing; invoices; service requests; appliance history. This gives
Robinson the ability to grow the B2B/property-management side of the
business.

## Service Area Management

Robinson could manage cities, ZIP codes, counties and future expansion
areas directly from the admin system. Customers would immediately know
whether their address qualifies for delivery.

## Admin Command Center

The owner would essentially have one screen showing: how much
recurring revenue we're generating; how much money we've collected;
how many customers we have; how many active rentals we have; how many
appliances we own; where every appliance is; what percentage of the
fleet is currently making money; what's available to rent; what's
sitting idle; what's being repaired; what's being delivered today;
what needs picked up; what service calls are open; who hasn't paid;
which appliances have paid for themselves; which machines are costing
us the most in repairs.

## Bottom Line

Instead of just rebuilding the website, we'd be building a complete
operating platform around the rental company.

Customer → Rental → Agreement → Payment → Appliance → QR Code →
Delivery → Service → Pickup → Re-rental

Everything would stay connected, giving Robinson a complete history of
every customer, rental, payment, and physical appliance from the day
the machine is purchased until the day it's retired.
