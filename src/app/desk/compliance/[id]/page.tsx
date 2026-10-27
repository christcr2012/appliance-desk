import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/kit";
import { requireRole } from "@/lib/session";
import { getComplianceFiling, submissionKeyFor } from "@/domains/compliance/filings";
import { obligationByKey } from "@/domains/compliance/registry";
import { FilingActions } from "./filing-actions";

export const metadata = { title: "Filing", robots: { index: false, follow: false } };

const fmtDay = (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);

const CHANNEL_WORDS: Record<string, string> = {
  DIRECT: "Filed from the app",
  UPLOAD_FILE: "The app prepares a file, you upload it",
  FILLED_FORM: "The app fills the official form, you submit it",
  GUIDED_WEB: "Step-by-step on the agency's site",
  ACCOUNTANT_PACKET: "Goes to your accountant in the year-end packet",
};

function preparedRows(data: unknown): Array<[string, string]> {
  if (!data || typeof data !== "object") return [];
  return Object.entries(data as Record<string, unknown>).map(([k, v]) => [
    k,
    typeof v === "object" ? JSON.stringify(v) : String(v),
  ]);
}

export default async function FilingPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const filing = await getComplianceFiling(id);
  if (!filing) notFound();
  const obligation = obligationByKey(filing.obligationKey);
  const rows = preparedRows(filing.preparedData);

  return (
    <div className="space-y-5">
      <p>
        <Link href="/desk/compliance" className="text-sm underline">
          ← All compliance
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-ink">{obligation?.title ?? filing.obligationKey}</h2>
        <StatusPill label={filing.state.replaceAll("_", " ").toLowerCase()} tone="neutral" />
      </div>
      <p className="max-w-3xl text-sm text-ink-soft">{obligation?.explain}</p>

      <dl className="grid max-w-3xl grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="font-medium text-ink">Period</dt>
          <dd>{filing.periodKey}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Agency</dt>
          <dd>{obligation?.agency ?? ""}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Do on</dt>
          <dd>{fmtDay(filing.actOn)}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Due</dt>
          <dd>{fmtDay(filing.dueOn)}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">How it&apos;s filed</dt>
          <dd>{obligation ? CHANNEL_WORDS[obligation.channel] : ""}</dd>
        </div>
        {obligation ? (
          <div>
            <dt className="font-medium text-ink">Source</dt>
            <dd>
              <a className="underline" href={obligation.sourceUrl} target="_blank" rel="noreferrer">
                {obligation.agency} (official)
              </a>
            </dd>
          </div>
        ) : null}
        {filing.confirmation ? (
          <div>
            <dt className="font-medium text-ink">Confirmation</dt>
            <dd>{filing.confirmation}</dd>
          </div>
        ) : null}
        {filing.submittedAt ? (
          <div>
            <dt className="font-medium text-ink">Submitted</dt>
            <dd>{fmtDay(filing.submittedAt)}</dd>
          </div>
        ) : null}
      </dl>

      {rows.length ? (
        <section className="max-w-3xl space-y-2">
          <h3 className="font-semibold text-ink">Prepared numbers</h3>
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="border-b border-border">
                  <th scope="row" className="py-2 pr-4 text-left font-medium text-ink">
                    {k}
                  </th>
                  <td className="py-2">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-ink-soft">
            Fingerprint of these numbers: {filing.preparedHash?.slice(0, 12)}… Approving uses exactly these
            numbers; if anything changes, you&apos;ll be asked to review again.
            {filing.state === "SUBMITTED" || filing.state === "ACCEPTED"
              ? ` Submission key: ${submissionKeyFor(filing).slice(0, 12)}…`
              : ""}
          </p>
        </section>
      ) : (
        <p className="max-w-3xl rounded-card bg-surface px-4 py-3 text-sm text-ink-soft">
          {filing.state === "UPCOMING" && obligation && obligation.unit !== "CMP-1"
            ? `The numbers for this filing are prepared in ${obligation.unit}. You can still mark it handled another way, or not needed, below.`
            : "Nothing prepared yet."}
        </p>
      )}
      {filing.note ? <p className="max-w-3xl text-sm text-ink-soft">Note: {filing.note}</p> : null}

      <FilingActions
        filingId={filing.id}
        state={filing.state}
        preparedHash={filing.preparedHash}
        channel={obligation?.channel ?? "GUIDED_WEB"}
        canPrepareGuided={filing.obligationKey === "co.sos.periodic_report"}
        isOwner={user.role === "OWNER"}
      />
    </div>
  );
}
