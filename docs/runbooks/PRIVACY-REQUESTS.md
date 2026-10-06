# Privacy request runbook

This is the operating procedure for Appliance Desk privacy export and deletion requests. It is a business workflow, not legal advice.

## Intake and verification

Signed-in customers can open a request from Account → Settings → Privacy requests. Their active customer session verifies identity immediately.

A public requester uses the form under `/privacy`. The public response is deliberately identical whether or not the email matches a customer. Known customer emails receive a single-use verification link when customer email is enabled; the link expires after 48 hours. If email is disabled or delivery is not attempted, the request stays **Received** and the owner verifies the person by phone before proceeding. Never disclose whether an email exists in Appliance Desk from the public form.

Public intake is limited to five attempts per IP-derived key per hour. The stored limiter key is hashed; clear-text IP addresses are not stored by the limiter.

## Owner processing

Use Desk → Privacy requests. Only the OWNER can process these requests.

For a **data export**, verify the request first, then download the JSON export. The export uses a fixed set of customer-owned records and does not include authentication credentials or sessions. Downloading the export marks that request fulfilled.

For a **deletion**, verify identity first. Read the retained-evidence warning, type `DELETE`, and submit. The operation is idempotent: repeating an already fulfilled deletion does not erase additional evidence.

A request may be rejected only with a recorded reason. Do not reject a request merely because financial or signed evidence must be retained; explain what can and cannot be deleted instead.

## What deletion changes

Deletion archives the customer login, revokes its sessions, clears stored authentication credentials/tokens, and pseudonymizes personal fields on the User, Customer, ServiceAddress, CustomerContact and associated Lead records. Optional address fields are cleared. Because the current database requires `ServiceAddress.line1`, `city`, `state` and `zip`, those required fields are replaced with non-identifying placeholders rather than `null`.

Photos attached only to that customer's maintenance request are deleted. Before bytes are removed, the private-media recovery layer writes a deterministic privacy tombstone and removes known recovery copies; restore code checks the live tombstone and will not resurrect the photo. A photo also tied to a job or appliance is retained as operational evidence.

## What deletion retains

Invoices, payments, receipts, refunds, customer credits, signature records, frozen DocumentArtifact evidence, customer notices and audit rows are retained. They are financial, signed-contract, delivery or audit evidence and are not silently destroyed by a privacy deletion.

If a case requires different retention behavior, stop and obtain legal/business direction before changing records outside this workflow.


## Drill

Automated coverage in `tests/privacy-requests.test.ts` proves verified deletion, external-storage failure/retry behavior, idempotency and retained evidence. `tests/media-inventory.test.ts` proves a privacy tombstone blocks later media recovery.

Last drilled: **2026-10-06 (automated CI coverage).**
