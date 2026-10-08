# T-5b2a — safe official-source HTTPS transport

Base: current main after the final reviewed communications-doc PR · Risk: SSRF / external network boundary · Migration: none · Production scope: one domain file
Parent: `T-5B2-OFFICIAL-SOURCE-WATCH.md`. This card is the first bounded execution slice; T-5b2b owns all watch business behavior.

## Read only
1. `docs/pr-cards/T-5B2-OFFICIAL-SOURCE-WATCH.md` — fetch requirements only.
2. `src/domains/tax/official-rate-metadata.ts` — source rows are owner-controlled metadata.
3. Narrow search for existing hardened HTTP helpers; reuse only if every requirement below is met.

## Build
Create `src/domains/tax/safe-official-source-fetch.ts` with:
- `fetchOfficialSourcePage(url, {timeoutMs?, maxBytes?})`;
- HTTPS only; no URL credentials or IP-literal hosts;
- reject localhost/internal/.local names;
- resolve every DNS answer and reject any loopback, RFC1918/private, CGNAT, link-local, multicast, unspecified, IPv6 loopback/link-local/ULA, IPv4-mapped unsafe address, or mixed public/private answer;
- pin the actual HTTPS socket lookup to a validated public answer while preserving the original hostname for TLS/SNI, so DNS rebinding cannot bypass validation;
- no redirect following; every 3xx is an error;
- default 10-second timeout and 1 MiB body cap; test overrides may only lower either limit;
- accept only `text/html` or `text/plain`;
- normalize line endings/horizontal whitespace, hash the complete accepted normalized body with SHA-256, return at most 200 KiB normalized UTF-8 text;
- never attach credentials/cookies and never log bodies, secrets, URLs containing credentials, or resolved private addresses.

No cron, database write, source activation, email, Today item, or tax interpretation in this PR.

## Tests
`tests/tax-safe-official-source-fetch.test.ts` proves:
- HTTP, redirects, URL credentials and IP literals rejected;
- IPv4 private/loopback/link-local/CGNAT plus IPv6 loopback/link-local/ULA/mapped-private rejected before request;
- mixed DNS rejected;
- HTTPS request uses the validated pinned address;
- timeout terminates and rejects;
- oversized/content-type failures;
- normalization + full-body hash + 200 KiB stored cap.

## Done
- exact-head typecheck/lint/focused test/CI/preview/review green;
- no reachable DNS-rebinding path;
- no application code calls the transport yet;
- T-5b2b remains the only consumer.
