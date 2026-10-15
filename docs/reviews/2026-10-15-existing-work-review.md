# Existing implementation review — October 15, 2026 UTC

Owner requested review of existing work after decision/design research.
Baseline: main `b4071206104df10dd957beefccaabacf7323776c`.
Concurrent PR #459 inspected at `c2cbe80f88da1fcdd62cf206dc8d682fcca37603`;
its branch was not modified. It subsequently merged as `5703c6ea`; that main
revision was reconciled before adding the viewed-quote repair.
This is a bounded financial/decision review, not a whole-application audit.

## Confirmed money-integrity defects repaired together

1. **Generic cancellation bypassed unresolved-payment protection.**
   `closeAgreementInTx` checked only SETTLED obligations. PREPARED/PENDING Stripe
   attempts could remain unresolved while their agreement became CANCELLED.
2. **Owner-reviewed cancellation missed unreconciled success.**
   `quoteInTx` selected only PREPARED/PENDING attempts. SUCCEEDED with an
   AWAITING_PAYMENT obligation and no receipt was treated as no received money.

Both now use `getSigningCancellationPaymentInTx`, after the agreement lock and
under the shared signing-obligation lock. Pending provider attempts, missing/
foreign/wrong-amount receipts and unreconciled/conflicting successes deny both
entry points. A manual reservation is not automatically collected money.
No refund, provider call, new money record or policy activation is introduced.
Existing reviewed refunds and legacy unpaid cancellation remain supported.

**Reproduction:** on unmodified baseline the three new PREPARED/PENDING/SUCCEEDED
generic-cancellation cases failed because cancellation incorrectly succeeded.
With the repair, 24 focused tests passed in the existing Vercel Sandbox's new
localhost-only PostgreSQL 18 cluster. The race observes an actual database lock
wait, commits an attempt from the lock holder, then proves cancellation denies
it without closing the agreement or creating a cancellation liability.
Required exact-head full CI remains separate pre-merge proof.

This is the immediate isolated money-hole fix required by AGENTS. The added
W-22FIN-CANCEL-SAFETY packet item is an internal remediation task under
W-22FIN-RECOVERY: **zero** completed predefined batch subsections. W-22FIN is
unfinished; this does not replace the substantial implementation workload target.

## Third confirmed defect repaired after PR #459 merged — viewed revision

At the inspected revision, `ApproveEstimateInput` and public `approveSchema`
contain name/email/IP but no expected quote fingerprint. `EstimateResponseForm`
receives only estimateId/allowApproval. `approveEstimate` compares today's
calculated quote with today's stored review, not the quote the customer viewed.

**Reproduction:** customer opens offer A → owner changes and resends offer B on
the same URL → customer approves from old A tab → both server fingerprints
match B. Four new missing/malformed/old-view regression cases failed against
merged `5703c6ea` because approval incorrectly succeeded.

**Repair:** the public page passes the rendered quote fingerprint through form
→ strict action parser → domain input. Under the estimate lock, the domain
compares it with stored review and the independently recomputed quote. Invalid
or stale revision denies before binding writes or checkout. Existing expiry
behavior stays intact. A form test proves exact viewed-revision submission, an
action test proves strict parsing and no checkout on denial, and real Postgres
tests prove missing/stale rejection and concurrent old/new-tab acceptance.
The combined repair passed 41 focused tests across seven files in disposable
PostgreSQL plus the UI test environment. Existing required full browser/CI gates
remain pre-merge requirements; no real customer/provider approval is inferred.

## Coverage and remaining scope

Inspected signing planning/snapshots, mandatory policy, frozen evidence,
obligation/readiness/attempt/manual/Checkout/settlement/recovery, first-invoice
gate/application, portal signing summary, dispatch readiness, agreement closure,
cancellation/refund evidence and reconciliation, plus PR #459 preparation/quote/
conversion and public approval action/form. Preserve exact-customer receipt
checks, immutable credit identity and independent refund authorization.

Known incomplete work remains: full nonzero mandatory-charge/reserve/RDF quote,
signed cancellation-policy provenance, prepaid large-order classification
independent of advance amount, and full multi-location cancellation/first-invoice
flows. Denying unsupported collection is not implementation of those outcomes.
Continue within W-22FIN using the integration contract and owner decisions.
Real CPA/counsel, provider TEST and checked release acceptance remain open.
