import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { twoFactorEnrollmentRequired } from "@/domains/security/two-factor";
import { getMcpIssuer } from "@/mcp/issuer";
import { grantedMcpScopes, type McpScope } from "@/mcp/scopes";

export type AgentContext = {
  userId: string;
  name: string;
  role: "OWNER" | "ADMIN";
  connectionId: string;
  connectionLabel: string;
  scopes: McpScope[];
};

function reject(issuer: string): Response {
  return new Response("Assistant authorization is required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/api/mcp"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function authenticateMcpRequest(request: Request): Promise<AgentContext | Response> {
  const issuer = getMcpIssuer();
  if (!issuer) return new Response(null, { status: 404 });
  if (!/^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "")) return reject(issuer);

  let claims: Record<string, unknown>;
  try {
    claims = await oauthProviderResourceClient().getActions().verifyAccessTokenRequest(request, {
      jwksUrl: `${issuer}/api/auth/jwks`,
      verifyOptions: { audience: `${issuer}/api/mcp`, issuer: `${issuer}/api/auth` },
    });
  } catch {
    return reject(issuer);
  }
  const userId = typeof claims.sub === "string" ? claims.sub : "";
  const clientId = typeof claims.azp === "string" ? claims.azp :
    typeof claims.client_id === "string" ? claims.client_id : "";
  if (!userId || !clientId) return reject(issuer);
  const tokenScopes = typeof claims.scope === "string" ? claims.scope.split(" ") :
    Array.isArray(claims.scopes) ? claims.scopes.filter((item): item is string => typeof item === "string") : [];

  const connection = await prisma.mcpConnection.findUnique({
    where: { userId_oauthClientId: { userId, oauthClientId: clientId } },
  });
  if (!connection || connection.revokedAt) return reject(issuer);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, archivedAt: true },
  });
  if (!user || user.archivedAt !== null || (user.role !== "OWNER" && user.role !== "ADMIN") ||
    await twoFactorEnrollmentRequired(userId, user.role)) {
    await prisma.mcpConnection.updateMany({
      where: { id: connection.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "Account access changed" },
    });
    return new Response("This account cannot use an assistant.", { status: 403 });
  }
  if (await isRateLimited(`mcp:${connection.id}`, { max: 120, windowMs: 600_000 })) {
    return new Response("Too many assistant requests.", { status: 429, headers: { "Retry-After": "60" } });
  }
  const now = new Date();
  if (!connection.lastUsedAt || now.getTime() - connection.lastUsedAt.getTime() >= 60_000) {
    await prisma.mcpConnection.updateMany({
      where: { id: connection.id, revokedAt: null, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } }] },
      data: { lastUsedAt: now },
    });
  }
  return {
    userId,
    name: user.name,
    role: user.role,
    connectionId: connection.id,
    connectionLabel: connection.label,
    scopes: grantedMcpScopes(tokenScopes, connection.scopes),
  };
}
