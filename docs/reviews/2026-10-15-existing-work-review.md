# Existing implementation review — October 15, 2026 UTC

Owner requested review of existing work after decision/design research.
Baseline: main `b4071206104df10dd957beefccaabacf7323776c`.
Concurrent PR #459 inspected at `c2cbe80f88da1fcdd62cf206dc8d682fcca37603`;
its branch was not modified. Refresh its actual head before applying findings.
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

## Blocking finding in open PR #459 — viewed revision is not submitted

At the inspected revision, `ApproveEstimateInput` and public `approveSchema`
contain name/email/IP but no expected quote fingerprint. `EstimateResponseForm`
receives only estimateId/allowApproval. `approveEstimate` compares today's
calculated quote with today's stored review, not the quote the customer viewed.

Reproduction recipe (source-confirmed; browser reproduction not claimed):
customer opens offer A → owner changes and resends offer B on the same URL →
customer approves from old A tab → both server fingerprints match B, so B can
be accepted without the customer having seen it.

**Required before accepting that implementation:** pass the rendered quote
fingerprint through form → strict action parser → domain input. Under the
estimate lock compare it with persisted review and independently recomputed
quote. Missing/malformed/stale values deny before approval, lead/account, audit,
status or deposit writes. Prove direct domain/API denial, two-tab resend,
concurrent edit/approval and unchanged-offer success in database/browser tests.
A hidden button is insufficient. Preserve separate signature/collection gates.
Reconcile at the implementing agent's current PR boundary; this review leaves
its branch untouched.

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
