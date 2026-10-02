# Package 6 Audit — Platform Integrity: Auth, Uploads, Backup & Compliance

**Audit date:** 2026-10-01  
**Repository:** `christcr2012/appliance-desk`  
**Audited branch:** `main`  
**Audited commit:** `851f31931f9b7cb3a300d4eaa580e78cb16d7dae`  
**Scope authority:** `docs/AUDIT_ROADMAP.md` Package 6  
**Status:** Audit complete; remediation not yet implemented by this report.

---

## Executive summary

Package 6 covers the platform boundaries that determine whether otherwise-correct business logic remains trustworthy in production: authentication and account recovery, session handling, file upload/read isolation, backup and restore, privacy/communications compliance, and sensitive-data handling in operational logs.

The codebase already has several strong protections that should be preserved. Protected business routes re-check the real Better Auth session server-side; archived accounts are rejected at direct access boundaries; login return paths are restricted to same-site paths; password-reset responses avoid obvious account enumeration; the photo-token endpoint authenticates first, validates record namespaces, constrains MIME types and file size, randomizes names, disables overwrite, rejects malformed paths, and is disabled in preview until independent storage is proven. The backup manifest forces an explicit include/exclude decision for every Prisma model, database JSON exports are written as private blobs, and a Neon point-in-time restore-to-branch drill was previously documented as successful. Security response headers, including HSTS and CSP, are also already present.

The most serious finding is an authentication design contradiction with a concrete pre-hijacking path. The product documentation says there is **no self-serve signup**, yet Better Auth email/password signup is enabled and `disableSignUp` is not set. Better Auth therefore exposes its normal public `POST /api/auth/sign-up/email` route. A public caller can create a `CUSTOMER`-role User for an email address before the business creates the real customer. Both lead conversion and direct customer creation then deliberately reuse an existing CUSTOMER User and attach a new Customer business record to it instead of replacing that credential. Because the pre-created password remains valid once the mailbox becomes verified, this can turn an unsolicited pre-registration into access to the later real customer record.

The remaining high-risk issues are concentrated in two areas:

- **private business evidence is stored as public media** — maintenance photos, job/condition photos and unit photos use the same `access: "public"` client-upload path as public catalog media, so read access is not tied to the signed-in customer or staff member once a Blob URL exists;
- **disaster recovery is an export, not yet a proven recovery system** — the daily JSON backup reads every table independently instead of from one database snapshot, has no tested JSON restore path, omits authentication credentials/webhook-dedupe state by policy, and backs up Photo rows/URLs without the uploaded file bytes themselves.

Additional platform gaps include password resets that leave old sessions alive, SMS STOP opt-outs that are not synchronized into the application's consent ledger, production fallback logging that can emit customer contact information and message content, and privacy-policy promises that do not yet have an implemented customer privacy-request workflow.

### Overall assessment

**CRITICAL RISK until the authentication pre-hijacking path is closed.**

The Critical rating is narrow and evidence-based. It does not mean the whole authentication system is broken: normal login/session role checks, archived-user denial and route ownership protections are materially sound. The Critical issue exists because a public account-creation capability conflicts with the app's server-created-account model and can preserve an attacker-chosen credential across later customer attachment.

| Severity | Findings |
| --- | ---: |
| Critical | 1 |
| High | 7 |
| Medium | 6 |
| **Total** | **14** |

---

# Audit scope

The audit followed Package 6 in `docs/AUDIT_ROADMAP.md` and reviewed:

- Better Auth email/password, verification and password-reset configuration;
- public auth endpoint exposure through the catch-all Better Auth route;
- customer/staff account creation and reuse rules;
- session duration, archived-account rejection, idle logout and recovery behavior;
- post-login return-path validation;
- upload-token authentication, role/record namespace authorization, MIME/size/path handling and preview isolation;
- persistence and rendering of customer/job/appliance photos;
- public vs private Vercel Blob behavior and available private/signed-URL capability;
- upload lifecycle, abandoned uploads and URL provenance;
- daily database export completeness, consistency, retention, failure behavior and restore readiness;
- file/media coverage in disaster recovery;
- SMS opt-in/opt-out persistence and Twilio STOP behavior;
- privacy-policy statements and customer privacy-request support;
- production logging behavior when email/SMS providers are missing or failing;
- privileged-account hardening, including MFA and session-management controls;
- overlap with Packages 1–5 so the same root cause is not counted twice.

Primary code reviewed included:

```text
src/lib/auth.ts
src/lib/session.ts
src/lib/auth-client.ts
src/lib/password-email.ts
src/lib/email.ts
src/lib/sms.ts
src/lib/deployment-safety.ts
src/proxy.ts
src/app/api/auth/[...all]/route.ts
src/app/login/actions.ts
src/app/login/login-form.tsx
src/app/forgot-password/forgot-password-form.tsx
src/app/reset-password/reset-password-form.tsx
src/components/idle-logout.tsx
src/components/photo-upload-field.tsx
src/app/api/uploads/photo/route.ts
src/domains/uploads/index.ts
src/app/account/maintenance/actions.ts
src/domains/portal/index.ts
src/domains/customers/index.ts
src/domains/leads/index.ts
src/domains/staff/index.ts
src/domains/backup/index.ts
src/domains/backup/manifest.ts
src/app/api/cron/backup/route.ts
src/domains/jobs/day-of-reminders.ts
src/app/(public)/privacy/page.tsx
next.config.ts
prisma/schema.prisma
tests/uploads-photo-route.test.ts
tests/backup.test.ts
tests/deployment-safety.test.ts
tests/idle-logout.test.tsx
tests/sms-preference.test.ts
tests/job-day-of-reminders.test.ts
tests/customer-isolation.test.ts
```

The audit also checked the live Vercel project/deployment inventory sufficiently to confirm that `appliance-desk` is the connected production project and that audited `main` commit `851f319...` is the current READY production deployment. No destructive production operation or test account was created.

Current vendor behavior was checked against the installed Better Auth 1.7.x configuration model and current Vercel Blob/Twilio documentation where that behavior materially affects a finding.

---

# Critical findings

## C1 — Public Better Auth signup can pre-create a CUSTOMER credential that later inherits the real customer record

**Severity:** Critical  
**Primary files:**

```text
src/lib/auth.ts
src/app/api/auth/[...all]/route.ts
src/domains/leads/index.ts
src/domains/customers/index.ts
docs/DECISIONS.md
```

### Problem

The product's account model is explicit: customers and staff are created by trusted server-side business workflows; there is no self-serve account registration.

`src/lib/auth.ts` even documents this assumption:

```text
there's no self-serve signup in this app
```

But the actual Better Auth configuration enables email/password authentication without disabling sign-up:

```ts
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  minPasswordLength: 10,
  ...
}
```

There is no:

```ts
disableSignUp: true
```

Better Auth's current `emailAndPassword.disableSignUp` default is `false`, and the default email/password API includes `POST /sign-up/email`. The application mounts Better Auth's complete handler at:

```text
/api/auth/[...all]
```

Therefore a public caller can create an unverified User row with:

- an arbitrary name;
- a victim's email address;
- an attacker-chosen password;
- the app's default `role = CUSTOMER`.

`requireEmailVerification` prevents immediate sign-in while that email remains unverified, but it does **not** prevent the account row and credential from being created.

The more serious problem appears later when the real business relationship is created.

### Lead conversion reuse

`convertLeadToCustomer()` normalizes the lead's email and looks up an existing User. It only rejects an existing account whose role is **not** CUSTOMER:

```ts
let account = await tx.user.findUnique({ where: { email } });
if (account && account.role !== "CUSTOMER") {
  throw new Error(...);
}
```

If the pre-created CUSTOMER User has no Customer row, conversion creates the real Customer and attaches it to that existing User:

```ts
customerRow = await tx.customer.create({
  data: { userId: account!.id, ... }
});
```

Because the User already existed:

```text
isNewAccount = false
```

so the normal activation/reset invitation is not sent and the existing password is not replaced.

### Direct customer creation reuse

`createCustomerDirectly()` follows the same core rule. An existing CUSTOMER User without a Customer row is accepted and then becomes the identity for the newly created business Customer. Again, `isNewAccount` is false, so the trusted account-invitation path does not replace the old credential.

### How this becomes a pre-hijacking path

A practical sequence is:

1. attacker submits a public Better Auth sign-up using `victim@example.com` and an attacker-known password;
2. Better Auth creates the unverified CUSTOMER User and credential;
3. later, the real victim becomes a customer and the business converts their lead or creates them directly;
4. that real Customer row is attached to the attacker's pre-created User identity;
5. Better Auth can send a verification email when verification is requested/sign-in is attempted;
6. if the actual mailbox owner follows the legitimate-looking Appliance Desk verification link, the email becomes verified but the attacker-chosen password remains the credential;
7. the attacker can then authenticate as the Customer whose real rental, service and billing data has now been attached.

Even before successful verification, the pre-created row can break the intended invitation/onboarding flow because the app treats it as an existing account and does not send the normal activation link.

### Why this matters

This defeats the core trust boundary of the customer portal: the application assumes the User being attached to a Customer was created by a trusted business workflow or already belonged to that real customer. Public sign-up invalidates that assumption.

Once the Customer row exists, downstream portal ownership checks correctly use the authenticated User ID — which makes this issue more consequential, not less. They will faithfully grant the pre-created identity access to the newly attached customer data.

### Required remediation

1. Disable public email/password signup immediately:

```ts
emailAndPassword: {
  enabled: true,
  disableSignUp: true,
  ...
}
```

2. Add a regression test against the actual Better Auth route proving an anonymous `POST /api/auth/sign-up/email` cannot create a User.
3. Harden lead/direct customer creation so an unexplained pre-existing CUSTOMER User without a matching trusted Customer relationship is **not silently adopted**.
4. Introduce an explicit account-claim/recovery state if legacy/unattached CUSTOMER users must be supported. The business record must not be attached to an existing credential merely because the email string matches.
5. Preserve the current atomic lead-conversion path for truly new accounts: trusted server creation + unusable random credential + customer-controlled reset/activation remains the right shape.
6. Review the production User table for CUSTOMER-role users with no Customer row before declaring this fixed. Do not delete them automatically; classify them and reconcile safely.

### Required tests

Add adversarial real-database/auth tests proving:

- anonymous sign-up is disabled;
- a pre-existing untrusted CUSTOMER User cannot be adopted by lead conversion;
- a pre-existing untrusted CUSTOMER User cannot be adopted by direct customer creation;
- a normal server-created customer still receives the expected activation flow;
- an existing legitimate Customer can still be recognized without duplicate creation;
- email verification cannot transform an unattached public account into portal access;
- staff/OWNER account emails remain protected from customer conversion as they are today.

### Acceptance criterion

There must be no sequence in which an anonymous caller can choose a password **before the business creates the customer** and retain that credential after real customer data is attached.

---

# High findings

## H1 — Customer and operational photos are stored as public-readable blobs, so read access is not record-scoped

**Severity:** High  
**Primary files:**

```text
src/components/photo-upload-field.tsx
src/app/api/uploads/photo/route.ts
src/domains/uploads/index.ts
src/app/account/maintenance/*
src/app/desk/jobs/*
src/app/desk/inventory/*
next.config.ts
```

### Problem

The upload-token route has good **write authorization**. It checks the signed-in session, validates the namespace against role/record ownership, restricts content types, caps a file at 15 MB, randomizes the object name and disables overwrite.

But every upload from `PhotoUploadField` is requested with:

```ts
access: "public"
```

and the component explicitly returns the resulting **public URL** to the caller.

The same component/storage mode is used for multiple data classes with very different privacy expectations:

- public appliance/catalog imagery;
- customer maintenance-problem photos;
- job/delivery/condition photos;
- individual appliance/unit photos.

Vercel's current storage platform supports private blobs and signed, expiring GET URLs specifically for sensitive user content. The current app does not use those controls for operational/customer media.

### Why this matters

The namespace checks prevent customer A from obtaining an upload token for customer B's maintenance folder, but after an operational photo exists its Blob URL is a bearer-style public object. Anyone who obtains the URL can fetch it without proving:

- they are signed in;
- they own the customer account;
- they are authorized staff;
- the linked job/appliance/request is still visible to them.

Random suffixes make blind guessing difficult, but **unguessability is not authorization**. URLs can leak through browser history, copied links, screenshots, logs, support conversations, referrer mistakes, exported database rows or compromised devices.

Customer maintenance photos can reveal a home's interior, appliance condition or surrounding property. Job/unit photos can contain serial labels, addresses or other operational evidence. Those should not have the same public-read policy as marketing/catalog images.

### Required remediation

Separate media classes:

- **public assets:** catalog/product/marketing photos may remain in public Blob storage;
- **private business/customer evidence:** maintenance, job, delivery, return, condition and unit-history photos should use private Blob storage.

For private media:

1. persist a stable blob pathname/key plus ownership/context metadata, not only an unrestricted URL;
2. serve through an authenticated download route or mint short-lived signed GET URLs;
3. re-check current customer ownership or team-role/record visibility before granting read access;
4. avoid exposing the underlying storage credential;
5. ensure archived/deleted records do not retain uncontrolled download links;
6. use the same access decision in thumbnails and full-resolution downloads.

### Required tests

Prove:

- signed-out requests cannot read a private maintenance photo;
- customer A cannot read customer B's maintenance photo even when given its object key;
- the owning customer can read their own maintenance photo;
- authorized STAFF/OWNER/ADMIN can read the operational photos they are permitted to view;
- public catalog imagery still renders without authenticated signed URLs;
- expired signed URLs stop working;
- removing access/deactivating an account prevents new private-media authorization.

---

## H2 — Password reset changes the credential but leaves existing sessions valid

**Severity:** High  
**Primary files:**

```text
src/lib/auth.ts
src/app/forgot-password/*
src/app/reset-password/*
src/lib/session.ts
```

### Problem

The Better Auth configuration implements a real one-time password-reset flow, but it does not set:

```ts
revokeSessionsOnPasswordReset: true
```

Better Auth's current default for that option is `false`.

The application's normal session lifetime is:

```text
14 days
```

with refresh after activity. Therefore a successful password reset does not, by configuration, guarantee that a previously stolen session token is invalidated.

### Why this matters

Users commonly reset a password specifically because they suspect compromise. If an attacker already has a live session cookie, changing the password should close that session unless there is an explicit, visible reason not to.

This is especially important for OWNER/ADMIN accounts, whose session can access customer identities, addresses, billing and business controls.

The client-side idle logout does not solve this: a stolen session replayed outside the victim's browser is not governed by the victim's local idle timer.

### Required remediation

Set Better Auth's password-reset session revocation option so successful recovery revokes existing sessions. Preserve a documented choice for whether the newly established recovery flow should create/retain one fresh session.

Also add an account security surface that lets a signed-in user review/revoke sessions, especially for OWNER/ADMIN.

### Required tests

Using real auth/session rows:

- create two sessions for one user;
- successfully reset the password;
- verify both old session tokens are rejected;
- verify the old password is rejected;
- verify the new password can create a new session;
- verify archived staff behavior still rejects access independently of password state.

---

## H3 — Daily JSON backup reads tables independently, so it is not a consistent database snapshot

**Severity:** High  
**Primary files:**

```text
src/domains/backup/index.ts
src/domains/backup/manifest.ts
tests/backup.test.ts
```

### Problem

`exportDatabaseBackup()` runs:

```ts
Promise.all(
  BACKUP_TABLES.map(async (table) => prisma[table].findMany())
)
```

Each `findMany()` is an independent database read. There is no single repeatable-read transaction or database-native snapshot spanning the exported tables.

The current unit test proves every expected delegate is read and one JSON object is uploaded. It does not prove all rows came from the same logical database instant.

### Example inconsistency

While the backup runs:

1. `RentalAgreement` is read;
2. a payment webhook commits a new Invoice + Payment + agreement billing-state update;
3. `Invoice` or `Payment` is read after that commit.

The resulting JSON can represent a state that never existed atomically: old parent/business state combined with newer dependent financial records.

The same class of inconsistency applies to assignments, jobs, referrals, credits, staff tasks and other related tables.

### Why this matters

A backup is valuable only if it can be restored into a coherent state. Cross-table time skew can produce:

- foreign-key ordering/reconstruction failures;
- business invariants that do not reconcile;
- duplicated or missing money/lifecycle state;
- misleading evidence during incident recovery.

### Required remediation

Choose one recovery-grade strategy and document it:

1. **database-native snapshot/export** from Neon/Postgres; or
2. run the logical export inside one bounded `REPEATABLE READ` transaction so every table sees the same snapshot.

Add explicit export metadata:

- format version;
- schema/migration identifier;
- exported-at time;
- source environment/database identity that is safe to record;
- table counts and optional checksums.

Do not silently increase transaction duration without measuring it. If the logical export becomes too large for a long transaction, move to a database-native export rather than reverting to inconsistent reads.

### Required tests

Add a real-Postgres concurrency test that mutates related records while export is paused and proves the resulting backup sees either the complete before-state or complete after-state, never a hybrid.

---

## H4 — The independent JSON backup is not yet proven restorable and omits recovery-critical identity/idempotency state

**Severity:** High  
**Primary files:**

```text
src/domains/backup/index.ts
src/domains/backup/manifest.ts
docs/ROADMAP.md
docs/PRODUCT-SPEC.md
docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md
```

### Problem

The code and docs correctly admit that the daily Blob object is a business-record export rather than a ready-to-restore database image:

```text
restoring it means re-inserting the JSON with a script
```

and:

```text
Restore procedures still require a separate recovery drill.
```

There is no repository restore implementation that consumes one of these JSON backups and reconstructs a disposable database while preserving constraints and sequence dependencies.

The manifest intentionally excludes:

```text
Session
Account
Verification
WebhookEvent
```

Those exclusions are individually defensible:

- sessions need not survive a disaster;
- verification tokens are ephemeral;
- storing password hashes in an extra generic export has security implications;
- webhook events can be large/operational.

But together they mean the JSON file cannot independently recreate a working system with existing customer/staff credentials and Stripe webhook deduplication history.

The previously documented Neon point-in-time restore-to-branch drill is valuable, but it proves **Neon's PITR path**, not the independent 30-day JSON backup path that exists specifically for incidents outside Neon's recovery window/provider boundary.

### Why this matters

A backup that has never been restored is an unverified archive. During a real incident, the team still has to invent:

- insertion order;
- identity/sequence restoration;
- how credentials are recovered or deliberately reset;
- how Stripe webhook replay is fenced without old `WebhookEvent` dedupe rows;
- how external provider IDs are reconciled;
- how to verify the recovered system before customer access is re-enabled.

### Required remediation

Create and drill a documented recovery procedure.

At minimum:

1. restore the JSON into a fresh disposable database using a maintained script;
2. rebuild records in dependency-safe order or use a deliberate constraint/import strategy;
3. define credential recovery: likely force password setup/reset rather than exporting reusable password hashes unless a separately encrypted credential backup is justified;
4. define webhook/provider reconciliation so Stripe events cannot be blindly duplicated after recovery;
5. run schema-health checks after restore;
6. compare record counts/checksums and high-value business invariants;
7. verify OWNER login recovery and one customer portal recovery flow;
8. document RPO/RTO and who performs each step.

### Required tests / drill evidence

A release-readiness gate should contain dated evidence that the **latest backup format** was restored to an empty disposable environment and passed:

- migrations/schema health;
- customer/agreement/invoice relationships;
- payment/refund totals;
- inventory assignments;
- audit/task references;
- owner access recovery;
- webhook/provider reconciliation safety.

---

## H5 — Database backups preserve Photo rows/URLs but not the uploaded file bytes

**Severity:** High  
**Primary files:**

```text
src/domains/backup/index.ts
src/domains/backup/manifest.ts
src/components/photo-upload-field.tsx
prisma/schema.prisma
```

### Problem

`Photo` database rows are included because the manifest includes business models, but `exportDatabaseBackup()` explicitly does **not** back up file bytes.

The saved rows therefore contain links to Vercel Blob objects that are outside the JSON payload.

If a Blob object is deleted, corrupted, lost through account/storage configuration changes, or the Blob store itself becomes unavailable, restoring the database backup only recreates a dead URL.

This affects:

- customer maintenance evidence;
- job/condition/delivery/return photos;
- appliance unit history;
- public product/catalog media where stored in Blob.

Future signed agreements/invoices or uploaded documents would have the same problem if they reuse this storage model.

### Why this matters

The independent backup is intended to protect the business from a provider/account/data-loss incident beyond Neon's short PITR window. Database rows that point to unprotected external objects do not constitute recovery of those records.

### Required remediation

Add a file-recovery strategy separate from the primary operational Blob store:

- periodic object inventory tied to database media records;
- copy/version objects into a second recovery location/control plane, or use an object-storage replication/versioning mechanism that meets the same goal;
- record checksum/size/content type so restored bytes can be verified;
- retain deletion tombstones/policy long enough to support legitimate recovery without defeating privacy deletion obligations;
- include file restoration in the same recovery drill as H4.

Do not make public operational photos the backup solution for themselves; H1 requires those to become private.

---

## H6 — “Reply STOP” can suppress Twilio delivery without updating the application's consent ledger

**Severity:** High  
**Primary files:**

```text
src/lib/sms.ts
src/domains/jobs/day-of-reminders.ts
src/domains/portal/index.ts
src/app/account/settings/*
prisma/schema.prisma
```

### Problem

The app has a good explicit portal opt-in model:

- SMS is off by default;
- customer must opt in;
- current state is stored in `Customer.smsOptInAt`;
- a `ConsentRecord` is written when the preference changes.

But outgoing reminders tell the customer:

```text
Reply STOP to opt out of texts.
```

Repository search found no Twilio inbound-message webhook/Event Stream consumer that translates a provider-level STOP into the application's own consent state.

Twilio itself blocks future messages after recognized STOP keywords. With Advanced Opt-Out/Event Streams, Twilio can also send the application `OptOutType=STOP`/`START` so the application's system of record can be synchronized.

Without that synchronization:

- Twilio may correctly block the number;
- `Customer.smsOptInAt` can remain non-null;
- the app continues selecting that customer for future SMS jobs;
- failed sends can repeat because the local system still believes consent is active;
- a later number/provider migration could accidentally rely on stale local consent;
- the ConsentRecord history does not reflect the withdrawal method the application's own message advertised.

### Required remediation

Before real SMS activation:

1. use a Twilio Messaging Service/number configuration that provides inbound STOP/START events;
2. add a Twilio-signed webhook or Event Stream consumer;
3. validate provider signatures/authenticity;
4. normalize the sending phone number to the same canonical format used by Customer;
5. on STOP, atomically clear `smsOptInAt` and append an immutable consent-withdrawal record including source/provider event ID/time;
6. decide and document START/UNSTOP policy before automatically re-enabling messages;
7. make incoming event handling idempotent;
8. preserve provider block-list behavior as an additional safety layer, not the only consent record.

### Required tests

Prove:

- STOP clears local eligibility;
- duplicate STOP webhook is harmless;
- STOP racing with the reminder cron cannot result in a new send after withdrawal is committed;
- provider signature failure is rejected;
- another customer's phone/event cannot alter the wrong record;
- START behavior follows the documented policy and creates new consent evidence.

---

## H7 — Missing production messaging configuration logs customer contact data and message content

**Severity:** High  
**Primary files:**

```text
src/lib/email.ts
src/lib/sms.ts
src/domains/jobs/day-of-reminders.ts
```

### Problem

Both provider wrappers safely no-op in preview before logging customer payloads. But in **production**, when provider configuration is missing, they log what they would have sent.

Email currently logs:

```text
Would have emailed <recipient>: "<subject>"
```

SMS currently logs:

```text
Would have texted <phone>: "<body>"
```

The SMS reminder body can include a street address:

```text
Reminder: we have ... scheduled for you today at <serviceAddress.line1>
```

This conflicts with the email helper's own nearby comment stating that it should not log recipients/message content.

### Why this matters

Provider misconfiguration is exactly when operators are likely to inspect or export logs. The current fallback can place:

- customer email address;
- phone number;
- message subject;
- visit/job context;
- street address

into Vercel/runtime observability logs.

Those logs have a different retention/access lifecycle than the customer record and are not part of normal privacy request/deletion handling.

### Required remediation

Use structured, redacted provider logs.

Safe example fields:

```text
channel=email
messageKind=customer_activation
providerConfigured=false
recordId=<internal id if needed>
```

Do **not** log:

- destination email/phone;
- message body;
- password/verification/reset links;
- street address;
- provider secrets/tokens.

Where debugging requires correlation, use a non-secret internal message/attempt ID.

### Required tests

Spy on `console.*`/logger output for:

- missing email configuration;
- missing SMS configuration;
- provider error;
- reset/activation messages;
- job reminder containing an address.

Assert that recipient, address, body and token-like values never appear in logged text or structured metadata.

---

# Medium findings

## M1 — Uploads have a per-file size limit but no per-user quota/rate limit or orphan cleanup lifecycle

**Severity:** Medium  
**Primary files:**

```text
src/app/api/uploads/photo/route.ts
src/components/photo-upload-field.tsx
src/app/account/maintenance/*
src/domains/uploads/index.ts
```

### Problem

The token route caps each object at 15 MB, but an authenticated caller can request repeated upload tokens with no app-level:

- per-minute/per-day upload quota;
- per-record object count limit at token-mint time;
- aggregate byte quota;
- outstanding-upload limit.

The browser uploads the Blob **before** the form/business record is committed. For example, a maintenance photo can upload successfully and then the customer can close the tab or fail validation before submitting the request. The Blob object remains even though no Photo row references it.

The final maintenance action limits stored `photoUrls` to six, but that does not limit how many objects can be uploaded and abandoned beforehand.

### Required remediation

Introduce a durable upload lifecycle:

1. create an upload intent/draft tied to actor + target context;
2. enforce per-user/per-record count and byte limits before minting token;
3. finalize the intent when a Photo/business row successfully references the object;
4. expire/delete unfinalized objects after a short TTL;
5. delete/retire the object when the owning Photo record is intentionally removed, subject to retention policy;
6. monitor storage volume and rejection rate.

Private-media work from H1 is the natural place to implement this.

---

## M2 — Maintenance submission accepts client-supplied image URLs without proving they came from this user's authorized upload

**Severity:** Medium  
**Primary files:**

```text
src/app/account/maintenance/actions.ts
src/domains/portal/index.ts
src/components/photo-upload-field.tsx
next.config.ts
```

### Problem

The normal UI supplies URLs returned by `PhotoUploadField`, but the server action's schema accepts any syntactically valid URL, up to six:

```text
z.string().trim().url()
```

The action does not prove that each URL:

- belongs to this application's Blob store;
- was uploaded under the current customer's namespace;
- was minted by this session;
- is still present;
- has an expected content type/size.

A direct caller can therefore persist an arbitrary URL into Photo rows. `next/image`'s remote-host allowlist limits which hosts render, but it is not an ownership/provenance check. Another compatible public Blob URL can still be supplied.

### Required remediation

Stop treating a client-returned URL as the authorization fact.

Persist/submit a server-recognized upload intent or blob pathname/object ID. At finalization, load that upload record and prove actor/namespace/status before attaching it to the maintenance request.

This should be implemented together with M1/H1 rather than as a separate ad-hoc URL regex.

---

## M3 — Idle timeout is browser-local; the server continues accepting the 14-day session until it is actually revoked/expired

**Severity:** Medium  
**Primary files:**

```text
src/components/idle-logout.tsx
src/app/desk/layout.tsx
src/app/account/layout.tsx
src/lib/auth.ts
```

### Problem

`IdleLogout` is useful protection for an unattended browser. It tracks keyboard/mouse/touch/scroll activity in localStorage and calls `signOut()` after 20 minutes in the desk or 30 minutes in the portal.

But the authoritative Better Auth session itself is configured for up to 14 days. The server does not track the browser's idle timestamp.

Therefore the 20/30-minute rule is not an authoritative server-side idle expiry for:

- a stolen/replayed session token;
- direct API/server-action requests that do not run the UI timer;
- a client where JavaScript/timers are suspended or disabled until later.

### Required remediation

Keep the existing UX timer, but distinguish it from server security.

For privileged sessions, choose one or more:

- shorter absolute session lifetime;
- server-tracked last-sensitive-activity/freshness;
- re-authentication for high-impact operations;
- explicit session inventory/revocation controls.

Document the actual server-side guarantee so “20-minute timeout” is not treated as stronger than it is.

---

## M4 — Backup failures have no durable run-health record, and the only owner alert can silently fail

**Severity:** Medium  
**Primary files:**

```text
src/app/api/cron/backup/route.ts
src/domains/backup/index.ts
src/lib/email.ts
```

### Problem

A failed export returns HTTP 500, which is useful platform telemetry, and `sendBackupFailureAlertToChris()` attempts an email.

But:

- there is no `BackupRun`/durable last-success record in the application;
- there is no owner-facing backup health screen/status;
- `sendBackupFailureAlertToChris()` ignores the `{ sent: false }` result from `sendEmail()`;
- the backup and its human alert can therefore fail together when messaging configuration/provider service is unhealthy.

### Required remediation

Persist each backup run (or at minimum last success/failure) with:

- start/end time;
- status;
- export identifier;
- table counts/checksum summary;
- pruned count;
- bounded error classification.

Expose “last successful recoverable backup” to OWNER/ADMIN and add an alert path independent of the same application email wrapper, e.g. Vercel monitoring/alerting or another operational channel.

A monitoring rule should fire on an overdue success even if the cron itself never ran.

---

## M5 — The public privacy policy promises signed-in privacy requests, but no customer request workflow is implemented

**Severity:** Medium  
**Primary files:**

```text
src/app/(public)/privacy/page.tsx
src/app/account/*
prisma/schema.prisma
src/domains/backup/*
```

### Problem

The public Privacy Policy says customers may request access/correction/deletion and specifically states:

```text
Signed-in customers can also request this directly from their account.
```

The schema's `ConsentRecord.kind` comment anticipates:

```text
data_export_request
data_deletion_request
```

but repository search found no implemented account action/page/domain flow that creates or manages those request types.

The policy also says data will eventually be deleted/anonymized after business/legal retention needs, while there is no end-to-end deletion/retention procedure covering:

- primary customer data;
- operational photos;
- launch/lead records where applicable;
- 30-day independent backups;
- provider/log copies.

The page is visibly marked as a draft, which is why this is not scored as a higher-severity claim of regulatory noncompliance. The issue is the product/policy mismatch itself.

### Required remediation

Before treating the policy as final:

- either remove/qualify the in-account promise until implemented; or
- implement a privacy-request workflow.

Recommended workflow:

1. signed-in customer creates access/correction/deletion request;
2. immutable request row records identity, type, time and status;
3. OWNER/ADMIN handles it through a queue with actor/time/outcome;
4. export gathers all customer-associated business data and media inventory intentionally;
5. deletion/anonymization has documented legal/tax retention exceptions rather than blind cascade delete;
6. backup retention and Blob deletion behavior are documented;
7. completion evidence is recorded without storing unnecessary copies of the exported PII.

Have counsel review the final policy/workflow before launch; this audit is an engineering review, not legal advice.

---

## M6 — OWNER/ADMIN authentication has no MFA and no user-facing session inventory/revocation surface

**Severity:** Medium  
**Primary files:**

```text
src/lib/auth.ts
src/app/account/*
src/app/desk/*
package.json
```

### Problem

The privileged desk currently relies on email/password plus normal session controls. No Better Auth two-factor/passkey/MFA plugin or equivalent privileged-account second factor is configured, and there is no application surface for an OWNER/ADMIN to inspect active sessions/devices and revoke one.

This is not a claim that password-only auth is inherently broken. The finding is risk concentration: one OWNER/ADMIN credential/session grants access to nearly all business/customer data and controls.

H2 makes the absence of session controls more important because password reset currently does not invalidate old sessions.

### Required remediation

Before production scale/employee expansion:

- require MFA for OWNER and preferably ADMIN;
- consider passkeys/TOTP/recovery codes supported by the chosen auth stack;
- add active-session listing/revocation;
- record security-sensitive auth events without storing secrets;
- document recovery if the owner loses the second factor.

Do not require customers to adopt the same privileged policy unless there is a separate business reason; role-sensitive controls are appropriate here.

---

# Verified strengths / concerns not promoted to findings

## 1. Upload token authorization is materially stronger than the public read model

The upload route is not an anonymous open bucket. It:

- requires a real server session;
- rejects archived accounts;
- refuses preview writes;
- validates a bounded request shape;
- checks role/record namespace through `canUploadPhoto()`;
- restricts JPEG/PNG/WebP/HEIC/HEIF;
- caps objects at 15 MB;
- adds a random suffix;
- disables overwrite;
- rejects path traversal/backslash/control/malformed namespace cases.

The Package 6 upload findings deliberately preserve these protections. The problem is primarily **read privacy and lifecycle**, not lack of all upload security.

## 2. Customer A/B database ownership checks remain a strength

Customer portal business-record access is tied to the authenticated User/Customer relationship and has real database-backed isolation tests. Package 6 does not duplicate Package 1 ownership findings already handled elsewhere.

## 3. Archived-account denial is already hardened at direct access boundaries

Recent session hardening rejects malformed role state and archived users in `getServerSession()`/`requireSession()` paths. Package 3 separately covers the narrower race where an already-authorized in-flight STAFF mutation can outlive a deactivation boundary; it is not counted again here.

## 4. Login return-path validation blocks obvious open redirects

`getPostLoginDestination()` accepts only same-app paths beginning with one `/` and rejects protocol-relative / backslash variants. No separate open-redirect finding is warranted from the reviewed login `next` flow.

## 5. Password-reset UI avoids obvious email enumeration

The public forgot-password form shows the same success message regardless of whether an account exists, matching the auth provider's enumeration-protection model. The reset token is delegated to Better Auth rather than implemented as an ad-hoc reusable secret.

## 6. Backup manifest coverage is actively schema-checked

`BACKUP_MODEL_POLICY` must explicitly include or exclude every Prisma model, and the test derives schema model names independently. This is good defense against adding a new business table and silently forgetting it in the export.

The Package 6 backup findings concern **snapshot/restore/media/recovery semantics**, not a false claim that random tables are already omitted unnoticed.

## 7. Backup JSON objects themselves are configured private

The database export uses `access: "private"`, unlike operational photos. This is correct for customer/billing data and should remain so.

## 8. Neon PITR has documented restore-to-branch evidence

The existing product docs record a successful Neon point-in-time recovery branch drill. That is valuable and should remain one layer of disaster recovery. It does not substitute for testing the separate JSON backup path whose purpose is to survive a different/longer provider failure.

## 9. SMS portal consent starts from the right principle

SMS preference is off by default and the app records explicit opt-in/opt-out changes. H6 does not argue for rebuilding that model; it requires provider-originated STOP/START changes to feed the same model.

## 10. Preview isolation protections are real and should not be removed

The audited `main` includes the Batch 1 hosted proof that preview database/private-file resources are isolated and that preview photo/production-backup paths fail closed. Package 6 does not reopen O02 as though that work never happened.

## 11. CSP/HSTS/security headers exist

The application emits HSTS, X-Content-Type-Options, frame denial, referrer policy, permissions policy and CSP. CSP includes deliberate `unsafe-inline` script/style trade-offs documented for Next.js/static rendering; no new generic “missing security headers” finding is justified here.

## 12. Broad `*.vercel.app` dynamic auth host fallback is not scored without environment proof

`src/lib/auth.ts` contains a fallback dynamic `allowedHosts` rule that accepts `*.vercel.app`. Current Better Auth documentation notes that dynamic allowed hosts also become trusted origins. A project-specific preview-host pattern would be tighter.

However, `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` take precedence over that object, and the available connected-project tooling did not expose enough environment-value evidence to prove which branch is active in each deployment without reading secrets. Therefore this audit does **not** turn the wildcard into a confirmed scored defect.

Before launch, verify the actual production/preview auth base-URL/trusted-origin values and tighten them to project-controlled hosts where practical.

---

# Remediation plan

The Package 6 findings should not become fourteen tiny pull requests. They cluster naturally into four substantial implementation outcomes that fit the owner's existing large-PR/low-CI-waste rule.

## Remediation A — Close the auth pre-hijack path and harden privileged recovery

**Findings:** C1, H2, M3, M6

### Build

- disable public Better Auth email/password signup;
- add direct-route regression coverage;
- refuse/quarantine unattached pre-existing CUSTOMER users during customer creation/conversion;
- inventory existing unattached CUSTOMER users safely;
- revoke existing sessions on password reset;
- add session inventory/revocation;
- add OWNER/ADMIN MFA or an explicitly approved equivalent privileged-access control;
- define server-side session freshness/re-auth for high-impact operations rather than describing browser idle logout as the full server boundary.

### Acceptance

- anonymous signup cannot create a User;
- attacker-precreated identity cannot inherit a Customer row;
- reset invalidates old sessions;
- privileged MFA/recovery works without locking the owner out;
- deactivated staff and malformed sessions remain denied;
- normal server-created customer activation still works.

---

## Remediation B — Make private media actually private and lifecycle-managed

**Findings:** H1, M1, M2

### Build

- separate public catalog media from private operational/customer media;
- move maintenance/job/unit evidence to a private Blob store/access mode;
- persist object identity/ownership metadata;
- authenticated/signed short-lived reads with current record authorization;
- server-recognized upload intent/finalization rather than arbitrary client URL attachment;
- per-user/per-record quotas;
- orphan cleanup TTL;
- intentional object deletion/retention behavior.

### Acceptance

- A/B customer media-isolation test;
- signed-out read denial;
- staff/owner allowed read path;
- public catalog asset remains public;
- abandoned object is cleaned;
- arbitrary public Blob URL cannot be attached as another customer's maintenance evidence.

---

## Remediation C — Turn backup export into a proven recovery system

**Findings:** H3, H4, H5, M4

### Build

- consistent database snapshot or database-native export;
- versioned backup format + migration/schema identity + checksums;
- durable backup-run health/status;
- independent overdue-success alert;
- restore script/runbook for an empty disposable environment;
- explicit credential recovery and Stripe webhook reconciliation policy;
- file-object inventory/secondary recovery copy;
- repeatable restore validation.

### Acceptance

A dated recovery drill from the latest backup format must demonstrate:

1. empty environment created;
2. schema prepared;
3. latest backup downloaded and verified;
4. records restored coherently;
5. private media recovered;
6. schema health passes;
7. money/assignment counts and selected invariants reconcile;
8. owner access recovered;
9. one representative customer portal record is correct;
10. provider/webhook replay is safe;
11. measured RPO/RTO recorded.

A backup should not be called recoverable solely because `put()` returned a URL.

---

## Remediation D — Close compliance-state and PII-observability gaps

**Findings:** H6, H7, M5

### Build

- authenticated/idempotent Twilio inbound opt-out synchronization;
- local ConsentRecord on provider STOP/START according to policy;
- redacted structured messaging logs;
- privacy-request workflow or revise the public draft policy until the workflow exists;
- documented primary/Blob/backup/log retention/deletion behavior.

### Acceptance

- STOP immediately removes local eligibility;
- no recipient/address/message/token PII appears in provider fallback logs;
- privacy request can be recorded, tracked and completed or the public copy no longer promises it;
- deletion/retention runbook explains the 30-day backup window and media behavior.

---

# Recommended remediation order

1. **C1 public signup/pre-hijacking** — close before adding more customer accounts.
2. **H2 password-reset session revocation** — small configuration change, high security leverage, but ship with real auth tests.
3. **H1 private operational media** — prevent new sensitive photos from accumulating as public objects.
4. **H6 STOP synchronization + H7 PII log redaction** — complete before SMS activation/scale.
5. **H3/H4/H5 backup recovery cluster** — make the independent backup actually recovery-grade before relying on its 30-day safety claim.
6. **M1/M2 upload lifecycle/provenance** — implement with the private-media redesign rather than a separate patch.
7. **M3/M6 privileged session/MFA hardening** — complete before broader staff/admin rollout.
8. **M4 backup-health monitoring** — complete with recovery work.
9. **M5 privacy request/retention alignment** — complete before final legal/privacy copy is treated as launch-final.

---

# Tests required before Package 6 can be called remediated

## Authentication

- anonymous `/api/auth/sign-up/email` denied;
- pre-registration/adoption attack test;
- customer activation happy path;
- verification/reset one-time behavior;
- reset revokes every old session;
- OWNER/ADMIN MFA and recovery;
- session revoke/list;
- archived staff remains denied;
- safe login redirect regression.

## Uploads/media

- token namespace path matrix by OWNER/ADMIN/STAFF/CUSTOMER;
- MIME/size/path traversal checks retained;
- customer A/B private media read isolation;
- signed-out private media denial;
- signed/private URL expiry;
- upload-intent finalization ownership;
- arbitrary URL rejection;
- quota enforcement;
- abandoned-upload cleanup;
- public catalog media unaffected.

## Backup/recovery

- schema manifest coverage retained;
- repeatable-read/snapshot concurrency proof;
- backup format/version/checksum proof;
- backup-run success/failure persistence;
- overdue backup monitoring;
- latest JSON restore into empty disposable DB;
- foreign-key/business-invariant verification;
- credential recovery proof;
- Stripe/webhook replay safety proof;
- private media restore proof.

## Compliance/observability

- portal opt-in/out consent remains atomic;
- signed provider STOP clears opt-in and appends consent evidence;
- duplicate/provider-invalid events safe;
- messaging logs contain no recipient/body/address/token;
- privacy request workflow/status/actor evidence or corrected public copy;
- documented backup/media retention effect on deletion requests.

---

# Definition of done for Package 6

Package 6 should be considered remediated only when all of the following are true:

- public account creation is impossible outside trusted business workflows;
- no pre-created credential can silently inherit a later Customer record;
- password recovery revokes compromised sessions;
- privileged accounts have an approved second-factor/session-recovery model;
- private operational/customer photos require current authorization to read;
- upload ownership/provenance and abandoned-object cleanup are enforced server-side;
- the database backup is point-in-time coherent;
- the independent backup format has been restored successfully in a current, documented drill;
- recovery covers file bytes or has an equally strong separate media-recovery path;
- backup health is observable even if application email is unavailable;
- STOP/START provider events cannot leave local SMS consent stale;
- production provider logs do not expose customer recipient/message/address data;
- public privacy promises match implemented request/retention behavior;
- focused tests, real Postgres/auth integration tests and the normal substantial-PR full CI gate pass;
- no live activation, destructive real-data reconciliation or provider messaging is performed without the owner's separate approval.

---

# Final Package 6 conclusion

The platform is not starting from a weak security posture. Several hardening decisions are already better than a typical early small-business application: server-side authorization, deactivated-session rejection, path-scoped upload tokens, preview fail-closed controls, schema-aware backup manifests, private backup objects, explicit SMS consent, security headers and a previously drilled database-host recovery path.

The final audit nevertheless found one severe trust-boundary contradiction that must be treated differently from ordinary backlog work: **the authentication provider still accepts public account creation even though every customer-attachment workflow assumes accounts are business-created or already legitimate**. That is the Package 6 Critical.

After that is closed, the largest remaining platform risk is not another hidden auth bypass. It is the gap between *having an export/photo URL* and *having a recoverable, access-controlled record*. Moving sensitive photos to private storage and proving a complete disaster-recovery path will convert the current collection of good component-level safeguards into a platform that can withstand both compromise and operational failure.

This report is intentionally remediation-oriented and does not mark any finding fixed merely because a provider offers the necessary capability. The code, tests and recovery evidence must demonstrate the final behavior.
