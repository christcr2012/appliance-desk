# Sources, pins and reconciliation

Inspected October 18, 2026 UTC (owner request October 17 America/Denver). Recheck compatible SDK/plugin releases at the engineering boundary; documentation URLs are evidence, not a dependency version lock.

| Source | Design use |
|---|---|
| Appliance Desk main `ef8af2cdd2e7dcd1322ff0163b32ca6ab34c42fe` | Existing health, ops keys, auth, backups, privacy, domain commands and test workflow |
| `src/domains/system-issues/{ops-api,ops-auth,queries,sources,render}.ts` | Existing bounded safe diagnostics; retain legacy authority |
| `src/domains/automation/{health,runs}.ts` and `src/app/desk/automations/page.tsx` | Shared state vocabulary, freshness, replay and diagnostics defects |
| `src/domains/backup/{index,manifest,media-deletion}.ts`; `scripts/{media-inventory,restore-backup}.ts` | Snapshot, upload, pruning, media tombstones and restore coverage |
| `src/lib/{auth,session,team-actor,photo-storage,deployment-safety}.ts` | Identity/role checks, private storage and developer runtime guards |
| `tests/{automation-health,automation-runs-integration,ops-api-integration,backup-export,backup-restore-integration,media-inventory}.test.ts` | Patterns to extend, not proof new MCP works |
| Hub [RTC 1](https://github.com/Robinson-AI-Systems/robinsons-toolkit-hub/blob/main/docs/CONTRACT.md) and [agent setup](https://github.com/Robinson-AI-Systems/robinsons-toolkit-hub/blob/main/docs/AGENT-SETUP.md) | Prefix, shared dispatcher, pass-only HTTP, envelopes, conformance, optional CLI/relay |
| [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) | OAuth resource metadata, PKCE, audience-bound tokens, discovery |
| [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | Remote transport and protocol negotiation |
| [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Tool schemas, annotations and discovery notifications |
| [MCP security](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices) | SSRF, token handling, untrusted tool content and confused-deputy defenses |
| [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider) | Provider adapter choice; check compatibility with installed Better Auth 1.7.6 at implementation |
| `docs/END-USER-AUTHORITY.md` | Developer restrictions are not permanent product limitations |

The baseline has no `@modelcontextprotocol/sdk` or OAuth-provider plugin dependency. Do not write imaginary plugin calls from memory. MCP-3 must pin a supported SDK/provider combination and record tested package versions, metadata routes and database schema in its JIT card. Prefer the maintained Better Auth OAuth-provider integration; retain current account provisioning, MFA, password recovery and disabled sign-up. If that package is incompatible, isolate the authorization-server adapter and document a tested compatible maintained provider before implementing it; do not hand-roll cryptography.

RTC 1 currently specifies conservative pass defaults and `confirm` for production/destructive/money/permission writes. These are real current interoperability requirements. Preserve them in the RTC adapter without turning them into permanent bans on authorized end-user execution. Direct MCP's user-selected policy may authorize unattended action; RTC clients must still send the wire confirmation. Never change the Hub contract in this project or claim conformance before running its pinned suite.
