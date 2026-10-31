import { DECLARED_RTC_CLIENTS, verifiedRtcClients, type RtcClientReceipt } from "@/mcp/rtc-client-matrix";

export function RtcClientEvidence({
  clients = DECLARED_RTC_CLIENTS,
}: { clients?: readonly RtcClientReceipt[] }) {
  const verified = verifiedRtcClients(clients);
  return (
    <div aria-labelledby="rtc-client-evidence-heading" className="rounded-control border border-line p-3 text-sm">
      <h3 id="rtc-client-evidence-heading" className="font-semibold text-ink">Verified assistant clients</h3>
      {verified.length === 0 ? (
        <p className="mt-1 text-ink-soft">
          No real assistant client has been verified yet. Automated tests and connected accounts
          are not proof that a particular client works.
        </p>
      ) : (
        <ul className="mt-2 list-inside list-disc space-y-1">
          {verified.map((client) => (
            <li key={client.client}>{client.client} — verified on app revision {client.revision}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-ink-soft">
        Try a supported client on the testing app, confirm a safe read and revocation,
        and record the client version and deployed revision before marking it verified.
      </p>
    </div>
  );
}
