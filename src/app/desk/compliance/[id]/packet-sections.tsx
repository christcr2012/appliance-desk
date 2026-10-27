import { formatMoney } from "@/lib/money-ui";
import type { PacketData } from "@/domains/compliance/schedule-c";
import type { Worksheet4562, Worksheet4797 } from "@/domains/compliance/worksheets";

/**
 * CMP-2: the filing-page sections for the income-tax filings — Schedule C
 * totals with the 1099-K tie-out, and the two worksheets. Everything
 * shown comes from the filing's prepared (and, once approved, locked)
 * numbers, never a live recompute.
 */

export function Worksheet4562Section({ worksheet }: { worksheet: Worksheet4562 }) {
  return (
    <section className="max-w-3xl space-y-2">
      <h3 className="font-semibold text-ink">Depreciation worksheet (Form 4562) — estimate, your CPA confirms</h3>
      {worksheet.rows.length === 0 ? (
        <p className="text-sm text-ink-soft">No appliances or equipment were placed in service in {worksheet.year}.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-4 font-medium text-ink">Asset</th>
              <th className="py-2 pr-4 font-medium text-ink">In service</th>
              <th className="py-2 pr-4 font-medium text-ink">Cost</th>
              <th className="py-2 pr-4 font-medium text-ink">Section 179</th>
              <th className="py-2 font-medium text-ink">Bonus</th>
            </tr>
          </thead>
          <tbody>
            {worksheet.rows.map((r) => (
              <tr key={r.assetNumber} className="border-b border-border">
                <td className="py-2 pr-4">
                  {r.assetNumber} — {r.description}
                  {r.needsReview ? " — tax evidence not recorded, CPA review needed" : ""}
                </td>
                <td className="py-2 pr-4">{r.placedInServiceOn}</td>
                <td className="py-2 pr-4">{formatMoney(r.costCents)}</td>
                <td className="py-2 pr-4">{r.section179Cents === null ? "not recorded" : formatMoney(r.section179Cents)}</td>
                <td className="py-2">{r.bonusCents === null ? "not recorded" : formatMoney(r.bonusCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-sm text-ink-soft">
        Placed in service this year: {worksheet.placedInServiceCount} (total cost {formatMoney(worksheet.totalCostCents)}).
        Still on the books from earlier years: {worksheet.priorAssetsCount} (cost {formatMoney(worksheet.priorAssetsCostCents)}).
        {worksheet.section179LimitCents !== null
          ? ` Section 179 limit for the year: ${formatMoney(worksheet.section179LimitCents)}.`
          : ""}
        {worksheet.bonusPercent !== null ? ` Bonus depreciation: ${worksheet.bonusPercent}%.` : ""}
      </p>
    </section>
  );
}

export function Worksheet4797Section({ worksheet }: { worksheet: Worksheet4797 }) {
  return (
    <section className="max-w-3xl space-y-2">
      <h3 className="font-semibold text-ink">Business property sales worksheet (Form 4797) — estimate, your CPA confirms</h3>
      {worksheet.rows.length === 0 ? (
        <p className="text-sm text-ink-soft">No retired appliances were sold in {worksheet.year}.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-4 font-medium text-ink">Asset</th>
              <th className="py-2 pr-4 font-medium text-ink">Sold</th>
              <th className="py-2 pr-4 font-medium text-ink">Price</th>
              <th className="py-2 font-medium text-ink">Estimated gain</th>
            </tr>
          </thead>
          <tbody>
            {worksheet.rows.map((r) => (
              <tr key={r.assetNumber + r.saleDate} className="border-b border-border">
                <td className="py-2 pr-4">
                  {r.assetNumber}
                  <span className="block text-ink-soft">{r.statusLabel}</span>
                </td>
                <td className="py-2 pr-4">{r.saleDate}</td>
                <td className="py-2 pr-4">{formatMoney(r.priceCents)}</td>
                <td className="py-2">
                  {r.taxGainCents === null
                    ? "not worked out"
                    : `${formatMoney(r.taxGainCents)} (recapture ${r.potentialRecaptureCents === null ? "—" : formatMoney(r.potentialRecaptureCents)})`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ScheduleCPacketSection({
  filingId,
  packet,
  outputsReady,
}: {
  filingId: string;
  packet: PacketData;
  outputsReady: boolean;
}) {
  const sc = packet.scheduleC;
  const tie = packet.tieOut;
  return (
    <div className="space-y-5">
      <section className="max-w-3xl space-y-2">
        <h3 className="font-semibold text-ink">Schedule C totals for {packet.year}</h3>
        <table className="w-full text-sm">
          <tbody>
            {sc.lines.map((line) => (
              <tr key={line.line} className="border-b border-border">
                <th scope="row" className="py-2 pr-4 text-left font-medium text-ink">
                  Line {line.line} — {line.label}
                </th>
                <td className="py-2 text-right">{formatMoney(line.cents)}</td>
              </tr>
            ))}
            <tr className="border-b border-border">
              <th scope="row" className="py-2 pr-4 text-left font-medium text-ink">Total income</th>
              <td className="py-2 text-right">{formatMoney(sc.totalIncomeCents)}</td>
            </tr>
            <tr className="border-b border-border">
              <th scope="row" className="py-2 pr-4 text-left font-medium text-ink">Total expenses</th>
              <td className="py-2 text-right">{formatMoney(sc.totalExpensesCents)}</td>
            </tr>
            <tr className="border-b border-border">
              <th scope="row" className="py-2 pr-4 text-left font-medium text-ink">
                Tentative profit (before any home-office deduction)
              </th>
              <td className="py-2 text-right font-semibold">{formatMoney(sc.netProfitCents)}</td>
            </tr>
          </tbody>
        </table>
        {sc.lines.find((l) => l.line === "27a")?.accounts.length ? (
          <p className="text-sm text-ink-soft">
            Other expenses (line 27a) by account:{" "}
            {sc.lines
              .find((l) => l.line === "27a")!
              .accounts.map((a) => `${a.name} ${formatMoney(a.cents)}`)
              .join("; ")}
            .
          </p>
        ) : null}
        {packet.homeOffice ? (
          <p className="text-sm text-ink-soft">
            Home office: your business facts say one is used. The method and amount are worked out with your CPA —
            nothing is claimed here.
          </p>
        ) : null}
      </section>

      <section className="max-w-3xl space-y-2">
        <h3 className="font-semibold text-ink">1099-K tie-out</h3>
        <p className="text-sm text-ink-soft">
          Card charges in the books: {formatMoney(tie.chargesCents)} (fees {formatMoney(tie.feesCents)}, refunds{" "}
          {formatMoney(tie.refundsCents)}, disputes {formatMoney(tie.disputesCents)}).{" "}
          {tie.reportedGrossCents === null
            ? "The amount from Stripe's 1099-K has not been typed in yet — add it in Business facts (that year's figures) and prepare again to see the tie-out."
            : `1099-K box 1a: ${formatMoney(tie.reportedGrossCents)}. Difference: ${formatMoney(tie.differenceCents ?? 0)}${(tie.differenceCents ?? 0) === 0 ? " — the books tie to the form." : " — your CPA will want to see why; timing of payouts and refunds is the usual reason."}`}
        </p>
      </section>

      <Worksheet4562Section worksheet={packet.worksheet4562} />
      <Worksheet4797Section worksheet={packet.worksheet4797} />

      {outputsReady ? (
        <section className="max-w-3xl space-y-2">
          <h3 className="font-semibold text-ink">Accountant packet files</h3>
          <p className="text-sm text-ink-soft">Built from the approved numbers above — send them to your accountant.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              <a className="underline" href={`/desk/compliance/${filingId}/outputs?kind=packet-pdf`}>
                Accountant packet (PDF)
              </a>
            </li>
            <li>
              <a className="underline" href={`/desk/compliance/${filingId}/outputs?kind=packet-csv`}>
                Accountant packet (CSV)
              </a>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
