# Privacy request runbook

This is the operating procedure for Appliance Desk privacy export and deletion requests. It is a business workflow, not legal advice.

## Intake and verification

1. A signed-in customer opens **Account → Settings → Privacy requests**. Their active customer session verifies identity immediately.
2. A public requester uses `/privacy`. Keep the response identical whether or not the email matches a customer. When customer email is enabled, a known customer email receives a single-use verification link that expires after 48 hours; otherwise leave the request **Received** for owner phone verification. Never disclose whether an email exists from the public form.
3. Leave the public rate limit in place: five attempts per IP-derived key per hour. The limiter stores only the hashed key, not the clear-text IP.

## Owner processing

1. Open **Desk → Privacy requests**. Only the OWNER may process a request.
2. For a **data export**, verify the request first, then download the JSON export. It excludes authentication credentials and sessions; downloading it marks the request fulfilled.
3. For a **deletion**, verify identity first, read the retained-evidence warning, type `DELETE`, and submit. Repeating an already fulfilled deletion must remain idempotent and must not erase additional evidence.
4. Reject only with a recorded reason. Do not reject merely because financial or signed evidence must be retained; explain what can and cannot be deleted instead.

## What deletion changes

Deletion archives the customer login, revokes its sessions, clears stored authentication credentials/tokens, and pseudonymizes personal fields on the User, Customer, ServiceAddress, CustomerContact and associated Lead records. Optional address fields are cleared. Because the current database requires `ServiceAddress.line1`, `city`, `state` and `zip`, those required fields are replaced with non-identifying placeholders rather than `null`.

Photos attached only to that customer's maintenance request are deleted. Before bytes are removed, the private-media recovery layer writes a deterministic privacy tombstone and removes known recovery copies; restore code checks the live tombstone and will not resurrect the photo. A photo also tied to a job or appliance is retained as operational evidence.

## What deletion retains

Invoices, payments, receipts, refunds, customer credits, signature records, frozen DocumentArtifact evidence, customer notices and audit rows are retained. They are financial, signed-contract, delivery or audit evidence and are not silently destroyed by a privacy deletion.

If a case requires different retention behavior, stop and obtain legal/business direction before changing records outside this workflow.


## Drill

Automated coverage in `tests/privacy-requests.test.ts` proves verified deletion, external-storage failure/retry behavior, idempotency and retained evidence. `tests/media-inventory.test.ts` proves a privacy tombstone blocks later media recovery.

Last drilled: **2026-10-06 (automated CI coverage).**
