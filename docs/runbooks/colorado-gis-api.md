# Colorado SUTS GIS API runbook

This runbook controls how Appliance Desk may integrate Colorado's Sales & Use Tax System (SUTS) GIS. It is an operational contract, not tax advice. **Never guess an API endpoint, authentication header, response field, tax rate, jurisdiction collection method, or bulk-result column.**

## Current implementation state

As of 2026-10-06, Colorado publicly documents how to obtain a GIS API key, but the API method details are shown only on the authenticated SUTS screen where the key is obtained. Those authenticated method details have not been supplied to this repository.

Therefore:

- `COLORADO_GIS_API_KEY` is optional and absence must not break startup.
- Appliance Desk uses the manual address-review flow when the authenticated contract is unavailable.
- The real HTTP client must remain disabled until this file records the authenticated endpoint, auth method, request parameters, response schema, error shapes, and published limits.
- Tests and CI must never call the real GIS.
- No raw GIS response is stored.
- The exact returned bulk-result CSV headers are also not publicly documented in the material currently available to the project, so the in-app bulk-result parser must reject unknown layouts instead of guessing columns.

This is the approved Batch T fallback, not a degraded-success claim: billing readiness later blocks any address/rate/policy that has not been explicitly reviewed.

## Owner setup — obtain and store the key

Colorado's public instructions are at:

- https://tax.colorado.gov/GIS-API
- https://tax.colorado.gov/SUTS-info

The Department's published flow is:

1. Register for SUTS if the business is not already registered.
2. Sign in to SUTS.
3. On the main SUTS homepage, open **Quick Links → Lookup API Key**.
4. Choose the business from the dropdown. SUTS displays the business's unique API key.
5. Add that value to Vercel as `COLORADO_GIS_API_KEY` for **Preview** and **Production**. Do not paste the key into a GitHub issue, pull request, chat, log, screenshot, test fixture, or repository file.
6. On the same SUTS key page, copy the **API method information/developer documentation only** — never the key — and use it to complete the contract section below in a reviewed PR.

If the key or contract is not available, do not block ordinary customer/address creation. The saved address becomes a tax-review item and billing remains gated later by Batch T readiness checks.

## Authenticated API contract gate

A real client may be implemented only after all of these facts are copied from the authenticated SUTS developer documentation and reviewed:

- request endpoint and HTTP method;
- exact API-key/header/query authentication rule;
- address request parameters and required/optional fields;
- success response schema, including jurisdiction code/name/type, rate and normalized/resolved address;
- whether the response identifies state-collected versus self-collected administration;
- error response shapes/status codes;
- request/rate limits or throttling guidance;
- any effective-date parameter or rate-effective-date field.

Until then, `src/domains/tax/colorado-gis.ts` must return the manual `UNAVAILABLE` result in production rather than inventing any of the above.

When the authenticated contract is added, the implementation requirements from `docs/designs/BATCH-T.md` still apply: eight-second timeout, one retry for network errors only, HTTP/shape failures mapped to `UNAVAILABLE`, zod validation, exact string-to-milli-percent conversion, and no raw-response storage.

## Public bulk-address service

Colorado's public bulk service is at:

- https://salestaxlookup.colorado.gov/bulk-address-lookup

The currently published **request** format for traditional-address uploads is:

| Column | Published meaning |
|---|---|
| `Address` | Full Colorado street address |
| `Product ID` | `1` for General Merchandise / Tangible Personal Property |
| `Customer Record ID` | Caller-assigned record identifier |
| `Date` | `Current` or one of Colorado's documented accepted date formats |

Colorado says returned files include the submitted record ID/data, resolved address, response status, State/County/City/Special District jurisdictions, jurisdiction codes, individual rate breakdowns and total rate. Published response statuses include **Rooftop**, **Address Approximated**, and **Not Colorado Address**.

The public page does **not** expose the exact returned CSV header names in the text available to this project. Do not infer them from the descriptive labels above. Once an official sample result file is obtained, record its exact header row here and add a synthetic fixture with the same shape; only then may `importBulkLookupFile` parse that layout.

## Manual fallback procedure

When automatic lookup is unavailable:

1. Save the customer/service address normally.
2. Appliance Desk writes a current `AddressTaxLocation` with `NEEDS_REVIEW` and a plain-English reason.
3. OWNER/ADMIN reviews the applicable tax jurisdictions and confirms them manually.
4. New jurisdictions, new GIS-discovered rates, missing rates, undecided taxability, or unreviewed jurisdictions remain separate readiness blockers. Confirming an address never silently confirms a tax rate or taxability rule.
5. Never type a rate from memory. Enter a rate/version only from an authoritative source and through the tax-policy workflow implemented by the applicable Batch T work unit.

## Data and privacy rules

- Never log the API key.
- Never store a raw GIS response.
- Normalized/resolved addresses are customer personal data. Privacy export includes the customer's tax-location records; privacy deletion clears normalized address and review-note text while retaining non-identifying tax evidence needed for financial/audit records.
- Synthetic tests may use fictional addresses and obviously synthetic rates only.
