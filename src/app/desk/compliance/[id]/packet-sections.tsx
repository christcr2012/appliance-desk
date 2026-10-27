import { formatMoney } from "@/lib/money-ui";
import { BppConfirmNoDeclaration } from "./bpp-confirm";
import type { PacketData } from "@/domains/compliance/schedule-c";
import type { Worksheet4562, Worksheet4797 } from "@/domains/compliance/worksheets";
import type { BppSnapshot } from "@/domains/compliance/bpp";

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

/**
 * CMP-4: the Weld property declaration section — the January 1 snapshot,
 * the exemption verdict, the extension choice and the downloads. All of
 * it comes from the filing's prepared snapshot, never a live recompute.
 */
export function BppSection({
  filingId,
  filingState,
  snapshot,
  outputsReady,
  dsFormsAvailable,
}: {
  filingId: string;
  filingState: string;
  snapshot: BppSnapshot;
  outputsReady: boolean;
  /** The vendored DS printings are the filing year's own (see vendoredDsForm). */
  dsFormsAvailable: boolean;
}) {
  const renters = new Set(snapshot.items.filter((i) => i.rentedOut).map((i) => i.userName).filter(Boolean));
  return (
    <div className="space-y-5">
      <section className="max-w-3xl space-y-2">
        <h3 className="font-semibold text-ink">
          January 1, {snapshot.year} snapshot — {snapshot.items.length} item
          {snapshot.items.length === 1 ? "" : "s"}, {formatMoney(snapshot.totalCostCents)} in original cost
        </h3>
        {snapshot.verdict === "UNDER" && snapshot.thresholdCents !== null && filingState === "NOT_APPLICABLE" ? (
          <p className="text-sm text-ink-soft">
            <span className="font-semibold text-ink">No declaration needed.</span> The total is at or under the{" "}
            {formatMoney(snapshot.thresholdCents)} exemption for {snapshot.year}, and you confirmed the tracked
            fleet is everything the business owns — this filing is closed as not needed with these numbers kept,
            so you can show the working if the assessor ever asks.
          </p>
        ) : snapshot.verdict === "UNDER" && snapshot.thresholdCents !== null && filingState === "READY_FOR_REVIEW" ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              <span className="font-semibold text-ink">This looks like no declaration is needed</span> — the
              tracked appliances total {formatMoney(snapshot.totalCostCents)}, at or under the{" "}
              {formatMoney(snapshot.thresholdCents)} exemption for {snapshot.year}. That total counts only the
              property the app tracks, though. If the business owns anything else declarable (tools, office
              equipment, signage), add its cost: over the line means a declaration is due, and approving this
              filing instead gives you the files with the fleet listing to attach. If the tracked fleet really
              is everything, confirm it and the filing closes as not needed with these numbers kept.
            </p>
            <BppConfirmNoDeclaration
              filingId={filingId}
              note={`No declaration needed — the January 1 total (${formatMoney(snapshot.totalCostCents)} in original cost) is at or under the ${formatMoney(snapshot.thresholdCents)} exemption for ${snapshot.year}, and the owner confirmed the tracked fleet is all the business property there is.`}
            />
          </div>
        ) : snapshot.verdict === "UNDER" && snapshot.thresholdCents !== null ? (
          <p className="text-sm text-ink-soft">
            The tracked total is at or under the {formatMoney(snapshot.thresholdCents)} exemption for{" "}
            {snapshot.year} — no declaration is owed on these numbers. You approved the filing anyway, so the
            files below carry the full listing if you want it on record with the assessor.
          </p>
        ) : snapshot.verdict === "OVER" && snapshot.thresholdCents !== null ? (
          <p className="text-sm text-ink-soft">
            Over the {formatMoney(snapshot.thresholdCents)} exemption for {snapshot.year} — the declaration is due
            April 15. File the filled forms or the spreadsheet with the Weld County Assessor.
          </p>
        ) : (
          <p className="text-sm text-ink-soft">
            The rule book has no exemption amount on file, so no exemption verdict is offered — the snapshot is
            ready, and the assessor or your CPA can confirm whether a declaration is due.
          </p>
        )}
        <p className="text-sm text-ink-soft">
          Totals use original cost: the assessor works out the actual value from the cost and the year acquired on
          their own schedules. If your total is anywhere near the exemption line, check with the assessor or your
          CPA before relying on the verdict.
        </p>
        {snapshot.items.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-4 font-medium text-ink">Asset</th>
                <th className="py-2 pr-4 font-medium text-ink">Description</th>
                <th className="py-2 pr-4 font-medium text-ink">Year</th>
                <th className="py-2 pr-4 font-medium text-ink">Cost</th>
                <th className="py-2 font-medium text-ink">On January 1</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.items.map((item) => (
                <tr key={item.assetNumber} className="border-b border-border">
                  <td className="py-2 pr-4">{item.assetNumber}</td>
                  <td className="py-2 pr-4">
                    {item.description}
                    {item.serialNumber ? ` — serial ${item.serialNumber}` : ""}
                  </td>
                  <td className="py-2 pr-4">{item.yearAcquired}</td>
                  <td className="py-2 pr-4">{formatMoney(item.costCents)}</td>
                  <td className="py-2">{item.rentedOut ? `Rented to ${item.userName ?? "a customer"}` : "On hand"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-soft">No business property was on the records for January 1.</p>
        )}
        {snapshot.firstTimeFiler ? (
          <p className="text-sm text-ink-soft">
            First-time filer: items over $350 are listed one by one ({snapshot.over350Count} of them), and the
            &ldquo;new business&rdquo; box is ticked on the DS 056.
          </p>
        ) : null}
        {snapshot.extension ? (
          <p className="text-sm text-ink-soft">
            Need more time? You can ask the assessor for an extension — the request must be in by April 15 and
            costs {formatMoney(snapshot.extension.tenDayFeeCents)} for 10 more days or{" "}
            {formatMoney(snapshot.extension.twentyDayFeeCents)} for 20.
          </p>
        ) : null}
        <p className="text-sm text-ink-soft">
          This snapshot covers the appliances the app tracks. Tools, office equipment and anything else the
          business owns are not in these records — add them by hand on the form before you file.
        </p>
      </section>

      {outputsReady ? (
        <section className="max-w-3xl space-y-2">
          <h3 className="font-semibold text-ink">Declaration files</h3>
          {dsFormsAvailable ? (
            <>
              <p className="text-sm text-ink-soft">
                Built from the approved snapshot above. The DS 056 prints the first 5 items and the DS 060 the first 4
                rented-out units; the spreadsheet lists every item and is the itemized listing the form asks you to
                attach.
                {renters.size > 1
                  ? " The DS 060's renter column can print only one name, so it is left blank when units are with different renters — each unit's renter is in the spreadsheet."
                  : ""}
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>
                  <a className="underline" href={`/desk/compliance/${filingId}/outputs?kind=ds056`}>
                    DS 056 — declaration schedule (PDF)
                  </a>
                </li>
                <li>
                  <a className="underline" href={`/desk/compliance/${filingId}/outputs?kind=ds060`}>
                    DS 060 — lessor schedule (PDF)
                  </a>
                </li>
                <li>
                  <a className="underline" href={`/desk/compliance/${filingId}/outputs?kind=bpp-csv`}>
                    Itemized listing spreadsheet (CSV)
                  </a>
                </li>
              </ul>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-soft">
                The filled DS 056 and DS 060 for {snapshot.year} appear here once the county publishes the{" "}
                {snapshot.year} printing — Weld County re-issues these forms every year with the year printed on
                them, and only that year&apos;s printing is safe to file. The spreadsheet below is the complete
                itemized listing the form asks you to attach, and it carries everything the forms ask for.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>
                  <a className="underline" href={`/desk/compliance/${filingId}/outputs?kind=bpp-csv`}>
                    Itemized listing spreadsheet (CSV)
                  </a>
                </li>
              </ul>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
