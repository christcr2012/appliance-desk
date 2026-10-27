import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/kit";
import { requireRole } from "@/lib/session";
import { formatMoney } from "@/lib/money-ui";
import { getComplianceFiling, getFilingReview, submissionKeyFor } from "@/domains/compliance/filings";
import { obligationByKey } from "@/domains/compliance/registry";
import { IRIS_MAX_ROWS_PER_FILE } from "@/domains/compliance/iris-csv";
import { FilingActions } from "./filing-actions";
import { ClassifyControls } from "./classify-controls";
import { BppSection, ScheduleCPacketSection, Worksheet4562Section, Worksheet4797Section } from "./packet-sections";
import { bppSnapshotFromPrepared } from "@/domains/compliance/bpp";
import { VoucherForm } from "./voucher-form";
import { getComplianceProfile } from "@/domains/compliance/profile";
import { vendoredDsForm, VOUCHER_BOOKLET_YEAR } from "@/domains/compliance/pdf-forms";
import type { PacketData } from "@/domains/compliance/schedule-c";
import type { Worksheet4562, Worksheet4797 } from "@/domains/compliance/worksheets";
import type { QuarterlyEstimate } from "@/domains/compliance/estimates";

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
  const { user } = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const { id } = await params;
  const filing = await getComplianceFiling(id);
  if (!filing) notFound();
  const obligation = obligationByKey(filing.obligationKey);
  const is1099 = filing.obligationKey === "fed.1099_nec" || filing.obligationKey === "fed.1099_misc";
  const isCmp2 = ["fed.income.schedule_c", "fed.4562", "fed.4797", "fed.estimated_tax", "co.income.dr0104ep"].includes(
    filing.obligationKey,
  );
  const isEstimate = filing.obligationKey === "fed.estimated_tax" || filing.obligationKey === "co.income.dr0104ep";
  const packet = filing.obligationKey === "fed.income.schedule_c" ? (filing.preparedData as PacketData | null) : null;
  const worksheet4562 =
    filing.obligationKey === "fed.4562"
      ? ((filing.preparedData as { worksheet4562?: Worksheet4562 } | null)?.worksheet4562 ?? null)
      : null;
  const worksheet4797 =
    filing.obligationKey === "fed.4797"
      ? ((filing.preparedData as { worksheet4797?: Worksheet4797 } | null)?.worksheet4797 ?? null)
      : null;
  const estimate = isEstimate ? (filing.preparedData as (QuarterlyEstimate & { payUrl?: string; payLabel?: string }) | null) : null;
  const isBpp = filing.obligationKey === "co.bpp.weld_declaration";
  const bppSnapshot = isBpp ? bppSnapshotFromPrepared(filing.preparedData) : null;
  const profile = isEstimate ? await getComplianceProfile() : null;
  const prepared = (filing.preparedData ?? {}) as {
    recipients?: { supplierId: string; name: string; tinLast4: string | null; hasW9: boolean; necCents: number; misc1Cents: number; misc3Cents: number }[];
    unclassifiedCategories?: { categoryId: string; name: string; cents: number }[];
  };
  const recipients = is1099 && Array.isArray(prepared.recipients) ? prepared.recipients : [];
  const unclassifiedCategories = is1099 && Array.isArray(prepared.unclassifiedCategories) ? prepared.unclassifiedCategories : [];
  const outputsReady = user.role !== "ACCOUNTANT" && ["APPROVED", "SUBMITTED", "ACCEPTED"].includes(filing.state);
  const formReady = ["READY_FOR_REVIEW", "APPROVED", "SUBMITTED", "ACCEPTED"].includes(filing.state);
  const review = await getFilingReview(filing.id);
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

      {rows.length && !is1099 && !isCmp2 && !isBpp ? (
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
      ) : rows.length === 0 ? (
        <p className="max-w-3xl rounded-card bg-surface px-4 py-3 text-sm text-ink-soft">
          {filing.state === "UPCOMING" && obligation && obligation.unit !== "CMP-1"
            ? `The numbers for this filing are prepared in ${obligation.unit}. You can still mark it handled another way, or not needed, below.`
            : "Nothing prepared yet."}
        </p>
      ) : null}
      {(is1099 || isCmp2 || isBpp) && filing.preparedHash ? (
        <p className="max-w-3xl text-sm text-ink-soft">
          Fingerprint of the prepared numbers: {filing.preparedHash.slice(0, 12)}… Approving uses exactly these
          numbers; if anything changes, you&apos;ll be asked to review again.
        </p>
      ) : null}
      {filing.note ? <p className="max-w-3xl text-sm text-ink-soft">Note: {filing.note}</p> : null}

      {is1099 && recipients.length > 0 ? (
        <section className="max-w-3xl space-y-2">
          <h3 className="font-semibold text-ink">Recipients</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-4 font-medium text-ink">Supplier</th>
                <th className="py-2 pr-4 font-medium text-ink">Tax ID</th>
                <th className="py-2 font-medium text-ink">Amount</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.supplierId} className="border-b border-border">
                  <td className="py-2 pr-4">
                    {r.name}
                    {r.hasW9 ? "" : " — no W-9 on file yet"}
                  </td>
                  <td className="py-2 pr-4">{r.tinLast4 ? `…${r.tinLast4}` : "not recorded"}</td>
                  <td className="py-2">
                    {formatMoney(filing.obligationKey === "fed.1099_nec" ? r.necCents : r.misc1Cents + r.misc3Cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {is1099 ? <ClassifyControls filingId={filing.id} categories={unclassifiedCategories} /> : null}

      {is1099 && outputsReady ? (
        <section className="max-w-3xl space-y-2">
          <h3 className="font-semibold text-ink">Filing files</h3>
          <p className="text-sm text-ink-soft">
            The portal file goes to the IRS IRIS Taxpayer Portal (upload under your TCC). Print or send each
            recipient their Copy B.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {Array.from({ length: Math.max(1, Math.ceil(recipients.length / IRIS_MAX_ROWS_PER_FILE)) }, (_, batch) => (
              <li key={batch}>
                <a className="underline" href={`/desk/compliance/${filing.id}/outputs?kind=csv&batch=${batch}`}>
                  {recipients.length > IRIS_MAX_ROWS_PER_FILE
                    ? `Portal file (CSV) ${batch + 1} of ${Math.ceil(recipients.length / IRIS_MAX_ROWS_PER_FILE)}`
                    : "Portal file (CSV)"}
                </a>
              </li>
            ))}
            {recipients.map((r) => (
              <li key={r.supplierId}>
                <a className="underline" href={`/desk/compliance/${filing.id}/outputs?kind=copy&supplier=${r.supplierId}`}>
                  Copy B for {r.name} (PDF)
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {filing.obligationKey === "fed.8300" && formReady ? (
        <section className="max-w-3xl space-y-2">
          <h3 className="font-semibold text-ink">Filled Form 8300 draft</h3>
          <p className="text-sm text-ink-soft">
            Check every field, then file on the BSA E-Filing system and paste its confirmation below.
          </p>
          <a className="text-sm underline" href={`/desk/compliance/${filing.id}/outputs?kind=form8300`}>
            Download the filled Form 8300 (PDF)
          </a>
        </section>
      ) : null}

      {packet && packet.scheduleC ? (
        <ScheduleCPacketSection filingId={filing.id} packet={packet} outputsReady={outputsReady} />
      ) : null}
      {bppSnapshot ? (
        <BppSection
          filingId={filing.id}
          filingState={filing.state}
          snapshot={bppSnapshot}
          outputsReady={outputsReady}
          dsFormsAvailable={
            vendoredDsForm("ds056", bppSnapshot.year) !== null && vendoredDsForm("ds060", bppSnapshot.year) !== null
          }
        />
      ) : null}
      {worksheet4562 ? <Worksheet4562Section worksheet={worksheet4562} /> : null}
      {worksheet4797 ? <Worksheet4797Section worksheet={worksheet4797} /> : null}

      {isEstimate && estimate ? (
        <section className="max-w-3xl space-y-3">
          <h3 className="font-semibold text-ink">This quarter&apos;s estimate</h3>
          {estimate.status === "OK" ? (
            <>
              <p className="text-sm text-ink-soft">
                Pay <span className="font-semibold text-ink">{formatMoney(estimate.quarterCents)}</span> for quarter{" "}
                {estimate.quarter}. Worked out by the safe-harbor method: {estimate.ratePercent}% of{" "}
                {estimate.priorYear}&apos;s tax ({formatMoney(estimate.priorTaxCents)}) is{" "}
                {formatMoney(estimate.annualCents)} for the year, divided by four. An estimate — your CPA confirms.
              </p>
              <p className="text-sm text-ink-soft">
                Pay online at{" "}
                <a className="underline" href={estimate.payUrl} target="_blank" rel="noreferrer">
                  {estimate.payLabel}
                </a>{" "}
                — the app never pays for you — or fill the paper voucher:
              </p>
              {user.role !== "ACCOUNTANT" && formReady && estimate.year === VOUCHER_BOOKLET_YEAR ? (
                <VoucherForm
                  filingId={filing.id}
                  quarter={estimate.quarter}
                  jurisdiction={estimate.jurisdiction}
                  defaultAddress={{
                    address: profile?.businessAddress ?? "",
                    city: profile?.businessCity ?? "",
                    state: profile?.businessState ?? "",
                    zip: profile?.businessZip ?? "",
                  }}
                />
              ) : formReady && user.role !== "ACCOUNTANT" ? (
                <p className="text-sm text-ink-soft">
                  The filled voucher booklet on file is for {VOUCHER_BOOKLET_YEAR}; for {estimate.year}, pay online
                  or use that year&apos;s paper voucher.
                </p>
              ) : null}
            </>
          ) : (
            <p className="rounded-card bg-surface px-4 py-3 text-sm text-ink-soft">
              There is no prior-year tax figure to work from yet, so no amount is shown — an estimate is never
              invented. Add last year&apos;s tax in Business facts (that year&apos;s figures) and prepare again, or
              enter an estimate from your CPA and pay it at{" "}
              <a className="underline" href={estimate.payUrl} target="_blank" rel="noreferrer">
                {estimate.payLabel}
              </a>
              , then mark this filing submitted.
            </p>
          )}
        </section>
      ) : null}

      <FilingActions
        filingId={filing.id}
        reviewedLabel={review ? `Reviewed by ${review.byName} on ${review.at.toLocaleDateString("en-US")}.` : null}
        state={filing.state}
        preparedHash={filing.preparedHash}
        channel={obligation?.channel ?? "GUIDED_WEB"}
        canPrepareGuided={[
          "co.sos.periodic_report",
          "fed.1099_nec",
          "fed.1099_misc",
          "fed.8300",
          "fed.income.schedule_c",
          "fed.4562",
          "fed.4797",
          "fed.estimated_tax",
          "co.income.dr0104ep",
          "co.bpp.weld_declaration",
          "greeley.business_license",
          "co.vehicle_registration",
          "fed.usdot",
        ].includes(filing.obligationKey)}
        isOwner={user.role === "OWNER"}
        separateSubmission={["UPLOAD_FILE", "ACCOUNTANT_PACKET", "FILLED_FORM"].includes(obligation?.channel ?? "")}
      />
    </div>
  );
}
