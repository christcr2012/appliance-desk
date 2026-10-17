# W-26 customer-language consumer reconciliation

Complete source coverage; diagnostic 38984045880 passed all unit/database and production browser shards. Final PR-head CI and merge remain pending.
The original subsection and counting boundary remain unchanged.

| Surface | Actual consumers and invariant evidence |
|---|---|
| Quote and response | Public estimate page and exact reviewed owner-written quote note, reviewed quote/order readbacks, approve/decline/change forms, deposit/continue/account-setup controls; exact amounts and separate nonbinding warning; rendered/transactional/catalog tests |
| Agreement/signing | Sign page and form, fixed/renewal disclosures, exact approved informational legal counterpart beside original English; locked digest validation and immutable recorded interface/legal language; rendered/runtime/database tests |
| Payment | Hosted signing Checkout freezes locale on its durable attempt; legacy historical parameters unchanged; billing portal locale, processing/cancel/error controls, unpaid/received/review-required distinctions; existing billing tests plus focused rendering tests |
| Portal | Shell/mobile navigation, home, rental/end/renewal controls, maintenance/photo/priorities, property contacts/permissions, billing and historical invoice wrapper, settings/privacy/SMS consent, credential/recovery and idle warnings; actual English records remain exact |
| Messages | Quote/follow-up, billing reminders, referral credits, privacy verification, annual/terms/renewal notices, customer credential/verification emails, consented template SMS use gated language/source consumers; no preference grants consent or authorizes a send |
| Owner templates | Independently editable subject/body, canonical source hashes, exact variable preservation, revision checks, runtime substitution, stale/missing/full-review gates; long legal/notice counterparts supported |
| Website fields | Independently editable Spanish counterparts and reviewed content read API. Public Spanish routes/SEO are explicitly Batch V (§6.6 and §9), not additional W-26 work |

`deliverMessage` caller classification was checked individually:

- Customer/lead journey: estimates (send and follow-up), billing reminders,
  referral credits, privacy verification and durable customer notices.
- Owner/internal: lead-intake notification, maintenance alert to owner, late-fee
  digest, backup notification, tax-source watch and messaging owner alerts.
- Public launch subscriber confirmation/sequence: Batch V public-launch path;
  it is not an owner message or a customer-account preference/consent grant.
- Credential messages bypass `deliverMessage`; their existing Better Auth
  provider callbacks now separately resolve an actual CUSTOMER preference.
  Staff credentials and verification remain English.

The source readiness declarations describe implemented consumers, not a fluent
review, legal authorization, publication, payment, receipt or merge acceptance.
Actual Spanish requires every current source plus the matching fluent/legal
review digest and explicit owner publication. A missing/stale translation or
withdrawn approval cannot silently activate part of the journey. The browser
fixture uses marked synthetic evidence only after verifying CI and the loopback
`appliance_desk_test` database and restores its changes in `finally`.

Independent review dispositions: digest binding, locking of draft validation,
Stripe locale idempotency, language snapshot coherence, new legal-source English
fallback, prior accepted notice reconciliation, SMS revoke independence, wrapper
fingerprint, translation length limits and portal legal sidecars were addressed.
Historical stored financial/legal artifacts are not regenerated or translated.
