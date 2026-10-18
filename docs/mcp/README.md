# Appliance Desk MCP — implementation entry point

Status: **DESIGN / NO MCP RUNTIME IMPLEMENTED BY THIS CHANGE**. Owner requested the design and repository setup on October 17, 2026. Source inspected October 18 UTC at `ef8af2cdd2e7dcd1322ff0163b32ca6ab34c42fe`. This is a new planned capability, not a claim that any tool works.

## Outcome

Connect a compatible AI client, sign in with the existing Appliance Desk account, choose delegated authority, and let it inspect, diagnose, monitor and repair the system within that authority. Software improvements use the repository's development workflow. The owner can see what each agent did and disconnect it. A customer or staff agent never acquires owner powers.

## Architecture decision

Implement a standalone network service at the existing application's `/api/mcp`, in this repository, backed by the same domain commands and database. A separate repository/deployment is unnecessary for the initial service: it would add network, authentication, drift and hosting boundaries without creating a new business authority. Keep `src/domains/agent-control/` and `src/mcp/` modular so later extraction can be deliberate. This is an MCP server independently connectable by URL; the optional Hub is not a dependency. Do not create another hosting project or duplicate provider MCPs.

## Read in order

1. Repository [AGENTS](../../AGENTS.md) and [session procedure](../SESSION-START.md).
2. [Architecture](ARCHITECTURE.md), then the selected subsection of [roadmap](ROADMAP.md).
3. [Authorization and security](SECURITY.md), [API and tool contract](CONTRACT.md), [persistence and recovery](DATA-AND-RECOVERY.md).
4. [Appliance Desk upgrade contract](APPLIANCE-DESK-UPGRADES.md).
5. [Acceptance ledger](acceptance.json), [owner experience and operations](OPERATIONS.md), [sources](SOURCES.md).
6. The first [execution card](../pr-cards/MCP-1.md); write later execution packets just in time against actual predecessor code.

The roadmap defines all planned units and acceptance. `acceptance.json` tracks their evidence; it does not create another active application execution packet. Existing F2 completion, PR #494 and the current work-index remain owned by their implementing session. Register MCP units with the shared index and its pinned validator together when MCP engineering becomes active; never silently replace F2 or weaken its coverage.

## First deliverable

Make the owner's reported backup failure and missing private photo-store configuration understandable and diagnosable, fix health presentation/freshness defects, and expose those same safe diagnostic facts to the MCP. Diagnose actual production backup failure separately with authorized logs; no root cause has been verified. Code inspection found a possible snapshot timeout, storage/configuration and pruning ambiguity; these are hypotheses, not diagnoses.

## Scope and state

This plan includes actual supported recovery execution, owner delegation, direct OAuth MCP, RTC-compatible HTTP tools, monitoring without a built-in LLM requirement, repair handoffs and measured optimization proposals. It does not implement any of them in this documentation change. No schedule, credential, production write, paid resource or release is activated. The October 1 Package 1 audit is historical input only; each finding must be reconciled with current code and tests before becoming an MCP incident or repair.

To resume: **“Implement the next Appliance Desk MCP bundle. Read AGENTS.md and docs/mcp/README.md; preserve unfinished F2 work and follow docs/mcp/ROADMAP.md.”**
