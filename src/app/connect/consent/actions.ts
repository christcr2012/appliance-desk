"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getMcpIssuer } from "@/mcp/issuer";
import { MCP_SCOPES, OAUTH_SCOPES } from "@/mcp/scopes";

export async function respondToAssistantConsent(data: FormData): Promise<void> {
  if (!getMcpIssuer()) throw new Error("Assistant connections are not available here.");
  const session = await requireRole("OWNER", "ADMIN");
  const oauthQuery = String(data.get("oauthQuery") ?? "");
  const accepted = data.get("decision") === "allow";
  if (oauthQuery.length > 4096) throw new Error("The assistant request was too long.");
  const input = new URLSearchParams(oauthQuery);
  const clientId = input.get("client_id");
  const requestedScopes = (input.get("scope") ?? "").split(/\s+/).filter(Boolean);
  if (!clientId || requestedScopes.some((scope) => !OAUTH_SCOPES.includes(scope as typeof OAUTH_SCOPES[number]))) {
    throw new Error("The assistant requested an unknown permission.");
  }
  const registered = await prisma.oauthClient.findFirst({ where: { clientId, disabled: { not: true } } });
  if (!registered) throw new Error("The assistant is no longer registered.");
  // The provider requires a real Request context to bind the signed OAuth
  // query, cookies, PKCE and consent. Calling auth.api.oauth2Consent directly
  // drops that context and the provider correctly rejects the request.
  const consentResponse = await auth.handler(new Request(`${getMcpIssuer()}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: new Headers({ "content-type": "application/json", cookie: (await headers()).get("cookie") ?? "" }),
    body: JSON.stringify({ accept: accepted, oauth_query: oauthQuery }),
  }));
  if (!consentResponse.ok) throw new Error("The assistant permission request expired or was rejected. Start again.");
  const result: unknown = await consentResponse.json();
  if (!result || typeof result !== "object" || !("url" in result) || typeof result.url !== "string") {
    throw new Error("The assistant authorization response was not valid.");
  }
  if (accepted) {
    await prisma.mcpConnection.upsert({
      where: { userId_oauthClientId: { userId: session.user.id, oauthClientId: clientId } },
      create: { userId: session.user.id, oauthClientId: clientId, label: registered.name?.slice(0, 80) || "AI assistant", scopes: requestedScopes.filter((scope) => MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number])) },
      update: { revokedAt: null, revokedReason: null, label: registered.name?.slice(0, 80) || "AI assistant", scopes: requestedScopes.filter((scope) => MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number])) },
    });
  }
  if (!result?.url) redirect("/desk/automations");
  // Redirect URL was validated against the registered OAuth client by the library.
  redirect(result.url);
}
