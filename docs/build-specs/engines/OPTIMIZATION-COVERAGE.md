# Build spec — Speed and slowness evidence, and a map of every setting (MCP-8)

Card: `docs/pr-cards/MCP-8.md`. Design: `docs/mcp/ARCHITECTURE.md` ("Optimization", "Extensibility and full useful
coverage"). Depends on MCP-5. Approved by Chris 2026-10-25.

**What Chris gets:** an assistant can see where the app is slow or busy (with real numbers over a stated period) and
write an improvement proposal for his coding agent, and it can tell him where any setting lives and which ones it can
change for him.

## 1. Measurements (additive, small)
- `PerfSample { id, kind (PAGE | ACTION | JOB | QUERY), name (route template, action name, rule key, or query label),
  ms Int, ok Boolean, at DateTime }` with `@@index([kind, name, at])`. Written by a tiny wrapper
  `measure(kind, name, fn)` used in: the desk layout's data reads (one per page render, route template from
  `toRouteTemplate`), server actions (via the existing action helper if there is one, else the top 20 actions by
  traffic chosen in the PR), `runAutomation` (duration already known), and named heavy queries (customer list view,
  money lists). **Sampling**: pages and actions write 1 in 10 (`Math.random() < 0.1`) to stay inside the database
  budget; jobs always. Retention 30 days, pruned by the nightly sweep (bounded delete of 5,000 per run). No user ids,
  no parameters, no URLs with ids.
- Observations: `getObservations({ window: "7d" | "30d", kind })` → per name: samples, p50, p95, error rate, change vs
  previous window; `samples < 30` → "Not enough data yet" (never a guess). Backlogs from existing data: To do counts
  by category, unpaid bills, open issues, waiting feedback, oldest age of each.

## 2. Proposals
`OptimizationProposal { id, number, title, observationRefs Json, expectedBenefit, risk, costNote, measurementPlan,
rollback, state (PROPOSED | ACCEPTED | REJECTED | DONE), repairCaseId? }`. Tools (journaled, `repairs:write`):
`appliance_optimization_get_observations` (ops:read), `appliance_optimization_create_proposal`. Accepting one (OWNER on
System health › Improvements) can open a repair case (MCP-6) for the coding agent. Nothing is tuned automatically;
prices, fees, legal/tax values are never "optimized" (refused by a fixed list of setting keys).

## 3. Settings map and control coverage
- `src/mcp/settings-map.ts`: every owner-facing setting and control (generated list: every field in the Settings page
  sections from `src/domains/settings/sections.ts`, every switch on System health, every decision subject), with `{
  key, label, screen href, who can change it, mcpStatus: "TOOL" | "PLANNED" | "NOT_APPLICABLE" | "PROVIDER_MANUAL",
  reason }`. A test fails when a settings section field has no row.
- Tool `appliance_where_is_setting { query }` (ops:read): fuzzy match label/key → screen, who can change, and whether
  the assistant can change it.
- `TOOL` rows in this unit: the System health controls (pause/resume, monitoring rule settings, backup retention,
  late grace) as MCP-5 actions with preview/approval. Business settings (prices, fees, terms) stay `PLANNED` with
  reason "Change in Settings; assistant changes need a separate approved card" — a deliberate safety line, explained
  on screen, not a permanent limit (`docs/END-USER-AUTHORITY.md`).

## 4. Tests
`tests/mcp-observations.test.ts` (percentiles, not-enough-data, no ids in names, sampling), `tests/mcp-control-coverage.test.ts`
(every setting mapped; every TOOL row has an action with a test), proposal refusal for protected keys.
