"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getMcpIssuer } from "@/mcp/issuer";
import { MCP_SCOPES } from "@/mcp/scopes";

export async function respondToAssistantConsent(data: FormData): Promise<void> {
  if (!getMcpIssuer()) throw new Error("Assistant connections are not available here.");
  const session = await requireRole("OWNER", "ADMIN");
  const oauthQuery = String(data.get("oauthQuery") ?? "");
  const accepted = data.get("decision") === "allow";
  if (oauthQuery.length > 4096) throw new Error("The assistant request was too long.");
  const input = new URLSearchParams(oauthQuery);
  const clientId = input.get("client_id");
  const requestedScopes = (input.get("scope") ?? "").split(/\s+/).filter(Boolean);
  if (!clientId || requestedScopes.some((scope) => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) {
    throw new Error("The assistant requested an unknown permission.");
  }
  const registered = await prisma.oauthClient.findFirst({ where: { clientId, disabled: { not: true } } });
  if (!registered) throw new Error("The assistant is no longer registered.");
  // The library validates its opaque authorization request code, PKCE, redirect, and real login.
  const result = await auth.api.oauth2Consent({
    headers: await headers(),
    body: { accept: accepted, oauth_query: oauthQuery },
  });
  if (accepted) {
    await prisma.mcpConnection.upsert({
      where: { userId_oauthClientId: { userId: session.user.id, oauthClientId: clientId } },
      create: { userId: session.user.id, oauthClientId: clientId, label: registered.name?.slice(0, 80) || "AI assistant", scopes: requestedScopes },
      update: { revokedAt: null, revokedReason: null, label: registered.name?.slice(0, 80) || "AI assistant", scopes: requestedScopes },
    });
  }
  if (!result?.url) redirect("/desk/automations");
  // Redirect URL was validated against the registered OAuth client by the library.
  redirect(result.url);
}
