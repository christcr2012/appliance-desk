# Existing Google Workspace connector: connection handoff

Inspected 2026-09-30 at Chris's request. Read-only investigation; no changes
made to this separate repository/project and no Google tools invoked.

## Found and verified

- Repository: https://github.com/Robinson-AI-Systems/google-workspace-mcp
- Vercel project: `google-workspace-mcp`
- Production deployment: `dpl_GYffbbtqzUJNCC2AZhZAvRLiXWQ4`, READY.
- Deployed commit: `16080d21b22933b4f0c90b968ec3d05cfe2096df`.
- Production alias: `google-workspace-mcp-five.vercel.app`.
- MCP URL: `https://google-workspace-mcp-five.vercel.app/api/mcp`.
- An unauthenticated request returned 401 with “Missing bearer token.” This
  proves the endpoint responds and requires authentication, not that the
  Google account/token or every tool currently works.
- Source `api/mcp.js` uses Streamable HTTP. OAuth metadata advertises dynamic
  client registration, authorization code and refresh-token flows.
- DEPLOY.md describes an existing connector passphrase (`ADMIN_PASSPHRASE`)
  gate, separate from the Google Workspace account authorization.
- README describes broad Gmail/Drive/Calendar/Docs/Sheets and Workspace admin
  tools, including destructive actions. The newest commit removed the Alert
  Center scope from the login request. Advertised tool counts are not a
  verification that all tools will succeed for the connected Google account.
- Catalog search did not surface this custom connector. Existing Google Drive
  and Calendar plugins were listed as installed; their presence does not
  connect this custom server or prove the intended account is selected.

## Connect in ChatGPT Work

Current official instructions:
https://developers.openai.com/plugins/deploy/connect-chatgpt
https://developers.openai.com/plugins/quickstart

1. Open ChatGPT Settings -> Security and login -> Developer mode, if available.
2. Open Plugins, select +, and enter a name such as Robinson Google Workspace.
3. Use the MCP URL above and OAuth authentication. The server supports dynamic
   registration, so leave optional client ID/secret fields blank initially.
   Do NOT paste the Google Cloud OAuth client secret into this connection form.
4. Complete the server's login using the existing connector passphrase only on
   its own authentication page. Do not send it in chat or commit it to a file.
5. Install the resulting personal plugin if prompted, then select it in Work
   with @ or the tools picker. Availability can depend on account/workspace policy.
6. First test: identify the connected account and list limited metadata (for
   example one task-list name), without sending mail or changing admin settings.
   Confirm it is the intended Appliance Rentals Workspace, not another business.

If Google was already linked during the Claude setup, do not reauthorize the
server to a different account just to add ChatGPT. Its documented hosted model
is one linked Google identity, not per-ChatGPT-user mailbox isolation. Existing
Google authorization may need renewal, but this was not checked. If setup
fails, capture the non-secret error text and diagnose registration/discovery
before changing credentials or permissions. Live OAuth metadata fetch through
the Vercel connector failed in this session; source metadata was inspected.
End-to-end ChatGPT authorization is still unverified.

## Where it helps this project

- Owner-input checklist can optionally be mirrored to a specifically chosen
  Google Tasks list after connection and authorization; docs stay the project
  decision source of truth. Do not silently create duplicate task systems.
- Read-only verification of the selected business mailbox/aliases can help
  close IN-02 without asking Chris to recreate existing infrastructure.
- A chosen shared calendar could mirror approved visits in a later phase;
  Appliance Desk remains scheduling authority. Use stable external IDs,
  explicit one-way ownership and duplicate prevention before any sync.
- Drive can hold approved business documents. Customer/private files require
  scoped sharing; a link existing in Drive does not make it public.
- Gmail assistance is a ChatGPT capability after connection, not an always-on
  backend worker. Background CRM synchronization needs its own authorized,
  audited service implementation; connecting this plugin does not create it.

Connecting does not authorize arbitrary messages, user administration,
permission expansion, deletions, or actions across other businesses. This
plan does not request changes to the connector's code or Google permissions.
