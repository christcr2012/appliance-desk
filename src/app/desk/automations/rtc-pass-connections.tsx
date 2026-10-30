import { prisma } from "@/lib/prisma";
import { getMcpIssuer } from "@/mcp/issuer";
import { CreateRtcPassForm } from "./rtc-pass-create-form";
import { revokeRtcPassAction } from "./rtc-pass-actions";

export async function RtcPassConnections({ ownerId }: { ownerId: string }) {
  const issuer = getMcpIssuer();
  const passes = await prisma.agentPass.findMany({
    where: { connection: { userId: ownerId } },
    select: { id: true, label: true, scopes: true, expiresAt: true, revokedAt: true },
    orderBy: { createdAt: "desc" }, take: 30,
  });
  return (
    <section id="rtc-passes" aria-labelledby="rtc-passes-heading"
      className="mb-6 space-y-3 rounded-card border border-line bg-surface p-4">
      <h2 id="rtc-passes-heading" className="text-base font-bold text-ink">
        Advanced: Robinson Toolkit pass (optional)
      </h2>
      <p className="text-sm text-ink-soft">For compatible HTTP assistants and the optional Robinson hub.
        A pass is not the same as an MCP sign-in. The starting pass is read-only and
        cannot move money, send messages or change settings. You can revoke it here at any time.</p>
      {issuer ? <p className="break-all text-sm text-ink-soft">HTTPS tool address: {issuer}/api/tools</p> : null}
      <CreateRtcPassForm />
      {passes.length > 0 && <ul className="space-y-2">
        {passes.map(pass => {
          const active = !pass.revokedAt && pass.expiresAt > new Date();
          return <li key={pass.id} className="rounded-control border border-line p-3 text-sm">
            <span className="font-medium">{pass.label}</span> — {active ? "Active" : "Expired or revoked"}
            <p className="text-ink-soft">{pass.scopes.join(", ")} · Expires {pass.expiresAt.toISOString().slice(0, 10)}</p>
            {active ? <form action={revokeRtcPassAction} className="mt-2">
              <input type="hidden" name="id" value={pass.id} />
              <button type="submit" className="min-h-11 rounded-control border border-line-strong px-3 py-2">
                Revoke pass
              </button>
            </form> : null}
          </li>;
        })}
      </ul>}
    </section>
  );
}
