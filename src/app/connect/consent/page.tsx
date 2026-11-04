import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMcpIssuer } from "@/mcp/issuer";
import { SCOPE_WORDS, OAUTH_SCOPES } from "@/mcp/scopes";
import { respondToAssistantConsent } from "./actions";

export const metadata = { title: "Connect an AI assistant" };

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!getMcpIssuer()) notFound();
  const session = await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  // Carry the provider's sealed request into the form WHOLE. The provider
  // signs the request and names every signed field in a repeated `ba_param`
  // entry; Next delivers a repeated field as a string array, so keeping only
  // plain string values silently drops that list (and any other repeated
  // field). The signature then no longer verifies, the provider refuses the
  // consent submission ("invalid signature"), and Allow can never record a
  // connection. Append every entry, repeats included, in order.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value)) for (const entry of value) query.append(key, entry);
  }
  const clientId = query.get("client_id") ?? "";
  const client = clientId ? await prisma.oauthClient.findFirst({ where: { clientId, disabled: { not: true } } }) : null;
  if (!client) notFound();
  const requested = (query.get("scope") ?? "").split(/\s+/).filter(Boolean);
  if (requested.some((scope) => !OAUTH_SCOPES.includes(scope as typeof OAUTH_SCOPES[number]))) notFound();
  let callbackHost = "Unknown callback";
  try { callbackHost = new URL(query.get("redirect_uri") ?? "").host; } catch { /* OAuth endpoint still validates it */ }
  return (
    <main className="mx-auto max-w-xl px-5 py-8 text-ink">
      <h1 className="text-[28px] font-extrabold">Connect an AI assistant</h1>
      <section aria-label="Assistant permission request" className="mt-5 rounded-card border border-line bg-surface p-5">
        <h2 className="text-base font-bold">{client.name || "An unnamed assistant"}</h2>
        <p className="mt-3 text-sm">Returning to: {callbackHost}</p>
        <p className="mt-3">It will act as you ({session.user.name}). It can’t see bank or card numbers or change anything.</p>
        <ul className="my-4 list-disc space-y-2 pl-5">
          {requested.map((scope) => <li key={scope}>{SCOPE_WORDS[scope as typeof OAUTH_SCOPES[number]]}</li>)}
        </ul>
        <form action={respondToAssistantConsent} className="flex flex-wrap gap-3">
          <input type="hidden" name="oauthQuery" value={query.toString()} />
          <button name="decision" value="deny" className="min-h-11 rounded-field border border-line-strong px-4 py-2">Don’t allow</button>
          <button name="decision" value="allow" className="min-h-11 rounded-field bg-primary px-4 py-2 font-bold text-on-primary">Allow</button>
        </form>
      </section>
    </main>
  );
}
