import { prisma } from "@/lib/prisma";
import { getMcpIssuer } from "@/mcp/issuer";
import { disconnectAssistant } from "./assistant-actions";

export async function AssistantConnections({ userId, canSeeAll }: { userId: string; canSeeAll: boolean }) {
  const issuer = getMcpIssuer();
  // Never hide a live assistant behind disconnected history. All active
  // connections remain reachable for Disconnect; only old history is capped.
  const filter = canSeeAll ? {} : { userId };
  const [active, disconnected] = issuer ? await Promise.all([
    prisma.mcpConnection.findMany({
      where: { ...filter, revokedAt: null }, include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.mcpConnection.findMany({
      where: { ...filter, revokedAt: { not: null } }, include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: 30,
    }),
  ]) : [[], []];
  const records = [...active, ...disconnected];
  return (
    <section aria-labelledby="assistant-connections-heading" className="mb-6 rounded-card border border-line bg-surface p-4">
      <h2 id="assistant-connections-heading" className="text-base font-bold text-ink">Connect an AI assistant</h2>
      {!issuer ? (
        <p className="mt-2 text-sm text-ink-soft">Not available on this copy of the app. The owner can configure a dedicated assistant connection address.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-soft">Add this address to an assistant that supports MCP. Sign in and approve only the information you want it to read.</p>
          <p className="mt-2 break-all rounded-field bg-surface-muted p-3 font-mono text-sm" aria-label="Assistant server address">{issuer}/api/mcp</p>
          {records.length === 0 ? <p className="mt-3 text-sm">No assistants connected yet.</p> : (
            <ul className="mt-3 space-y-3">
              {records.map((record) => (
                <li key={record.id} className="rounded-field border border-line p-3">
                  <p className="font-medium">{record.label}</p>
                  <p className="text-sm text-ink-soft">{record.revokedAt ? "Disconnected" : "Connected"} · {record.scopes.join(", ")}{canSeeAll ? ` · Approved by ${record.user.name ?? "a team member"}` : ""}</p>
                  {!record.revokedAt && (
                    <form action={disconnectAssistant} className="mt-2">
                      <input type="hidden" name="id" value={record.id} />
                      <button type="submit" className="min-h-11 rounded-field border border-line-strong px-3 py-2">Disconnect</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
