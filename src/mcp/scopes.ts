/** MCP-3 read-only assistant grants; later cards add explicit action scopes. */
export const MCP_SCOPES = ["ops:read", "decisions:read"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const SCOPE_WORDS: Record<McpScope, string> = {
  "ops:read": "See whether jobs, backups and settings are working and the problems they found",
  "decisions:read": "See open business questions and their starting values",
};

export function grantedMcpScopes(tokenScopes: string[], connectionScopes: string[]): McpScope[] {
  return MCP_SCOPES.filter((scope) => tokenScopes.includes(scope) && connectionScopes.includes(scope));
}
