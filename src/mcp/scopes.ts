/** MCP-3 read-only assistant grants; later cards add explicit action scopes. */
export const MCP_SCOPES = ["ops:read", "decisions:read", "ops:maintain", "decisions:apply"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
/** Standard OAuth refresh permission; not a business-data or tool scope. */
export const OAUTH_SCOPES = [...MCP_SCOPES, "offline_access"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const SCOPE_WORDS: Record<OAuthScope, string> = {
  "ops:read": "See whether jobs, backups and settings are working and the problems they found",
  "decisions:read": "See open business questions and their starting values",
  "ops:maintain": "Run approved health and backup maintenance actions",
  "decisions:apply": "Apply business answers after explicit approval",
  "offline_access": "Stay connected with renewable access until you disconnect the assistant",
};

export function grantedMcpScopes(tokenScopes: string[], connectionScopes: string[]): McpScope[] {
  return MCP_SCOPES.filter((scope) => tokenScopes.includes(scope) && connectionScopes.includes(scope));
}
