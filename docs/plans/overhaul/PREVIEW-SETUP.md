# O02 preview database safeguard

Status: IN_REVIEW safeguard; full O02 incomplete.

Read-only Neon metadata on 2026-09-30 verifies project jolly-term-08991992:
- Production main: br-wild-smoke-b7etke32, ep-ancient-glitter-b7q9bto9.
- Separate vercel-preview-2: br-broad-union-b784qy62, ep-silent-hill-b7rpraoc.

preview-database-safety.ts permits the verified preview endpoint's stable
direct/pooled aliases only, database appliance_desk, standard Postgres protocol
and port. DIRECT_URL must be unpooled. Missing, malformed, production, unknown
and alternate query-parameter targets fail closed without printing secrets.
prisma.config.ts calls this before Prisma CLI connects; lib/prisma.ts calls
it before creating or reusing the runtime client. Endpoint replacement must
be verified through Neon before changing the non-secret allowlist.
Production and local/CI without Vercel markers retain existing behavior.

Preview email/SMS remain suppressed; Stripe requires test keys. Preview photo
uploads and backup operations remain disabled until independent storage is
verified. No environment secrets/targets were mutated. A passing preview build
proves configured migration/runtime URLs pass the guard and schema reads work;
it does not constitute the required disposable runtime-fixture proof or
independent file workflow. Those, and upgrade proof, remain O02 acceptance gates.
