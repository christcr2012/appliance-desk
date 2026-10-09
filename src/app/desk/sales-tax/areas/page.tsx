import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getTaxAreasPage } from "@/domains/tax/workspace-queries";
import { listOfficialRateAttention } from "@/domains/tax/official-rate-auto-apply";
import { TaxActionForm } from "../setup/forms";
import { acknowledgeSource, reviewOfficialRate, undoOfficialRate, confirmAddressAction } from "./actions";

const formatRate = (v: number) => (v / 1000).toFixed(3) + "%";
type Query = { cursor?: string; status?: string };
export default async function TaxAreasPage({ searchParams }: { searchParams: Promise<Query> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const owner = session.user.role === "OWNER";
  const query = await searchParams;
  const status = query.status === "REVIEW" || query.status === "VERIFIED"
    ? query.status : undefined;
  const [areas, attention, sources, jurisdictions] = await Promise.all([
    getTaxAreasPage(session.user.id, { limit: 25, cursor: query.cursor, status }),
    listOfficialRateAttention(),
    prisma.officialSourceWatch.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 75 }),
    prisma.taxJurisdiction.findMany({
      select: { id: true, name: true, reviewStatus: true, rates: {
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }], take: 1,
        select: { rateMilliPercent: true, effectiveFrom: true, source: true },
      } },
      orderBy: [{ name: "asc" }, { id: "asc" }], take: 75,
    }),
  ]);
  const next = new URLSearchParams();
  if (status) next.set("status", status);
  if (areas.nextCursor) next.set("cursor", areas.nextCursor);
  return <main className="space-y-8">
    <h2 className="text-xl font-semibold">Tax areas and official rate sources</h2>
    <p className="text-sm text-muted-foreground">Current service-address tax matches and owner-reviewed jurisdiction rules. If a provider cannot confirm an address or a rate, keep it in review instead of treating an unknown result as verified.</p>
    <nav className="flex flex-wrap gap-3 text-sm underline" aria-label="Tax areas sections">
      <a href="#addresses">Address review</a><a href="#rates">Rate decisions</a>
      <a href="#sources">Source status</a><a href="#jurisdictions">Jurisdictions</a>
    </nav>
    <section id="addresses" className="space-y-3">
      <h3 className="font-semibold">Service-address tax review</h3>
      <nav aria-label="Filter tax areas" className="flex flex-wrap gap-3 text-sm">
        <Link href="/desk/sales-tax/areas">All current</Link>
        <Link href="/desk/sales-tax/areas?status=REVIEW">Needs review</Link>
        <Link href="/desk/sales-tax/areas?status=VERIFIED">Verified</Link>
      </nav>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {areas.rows.map(row => <li key={row.id} className="flex flex-wrap justify-between gap-3 p-3">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{row.city}, {row.state} {row.zip} — {row.status === "VERIFIED" ? "Verified" : row.status === "FAILED" ? "Lookup failed" : "Needs review"}</p>
            <p className="text-xs text-muted-foreground">{row.line1} · Provider: {row.source} · Checked {row.lookedUpAt.toISOString().slice(0, 10)}</p>
            <p className="text-xs">{row.jurisdictions.length ? row.jurisdictions.join(", ") : "No matching tax areas confirmed"}</p>
            {row.reviewNote && <p className="text-sm text-destructive">Review note: {row.reviewNote}</p>}
          </div>
          <div className="space-y-3">
            <Link className="block text-sm underline" href={`/desk/customers/${row.customerId}`}>Open customer</Link>
            {row.status !== "VERIFIED" && <TaxActionForm action={confirmAddressAction}
              title="Verify tax jurisdictions for this address" submitLabel="Confirm address areas">
              <input type="hidden" name="serviceAddressId" value={row.serviceAddressId} />
              <label className="block space-y-1 text-sm">
                <span>Select all matching reviewed tax areas (multiple choices)</span>
                <select multiple name="jurisdictionIds" required size={Math.min(6, Math.max(2, jurisdictions.length))}
                  className="w-full rounded border border-border bg-background p-2 text-foreground"
                  defaultValue={jurisdictions.filter(j => row.jurisdictions.includes(j.name)).map(j => j.id)}>
                  {jurisdictions.filter(j => j.reviewStatus === "REVIEWED").map(j =>
                    <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">Compare your selection with the official Colorado source before confirming. This action records your identity and overrides unknown provider results.</p>
            </TaxActionForm>}
          </div>
        </li>)}
        {!areas.rows.length && <li className="p-3 text-sm text-muted-foreground">No matching addresses. Unverified GIS results are not silently treated as successful lookup.</li>}
      </ul>
      {areas.nextCursor && <Link className="text-sm underline" href={`/desk/sales-tax/areas?${next.toString()}`}>Next addresses</Link>}
    </section>
    <section id="rates" className="space-y-3">
      <h3 className="font-semibold">Official rate review and undo</h3>
      {!attention.length && <p className="text-sm text-muted-foreground">No pending/scheduled official rate decisions.</p>}
      {attention.map(row => <div className="space-y-2 rounded-lg border border-border p-4" key={row.kind === "SCHEDULED" ? row.rateVersionId : row.observationId}>
        <p className="font-semibold">{row.jurisdictionName}: {formatRate(row.oldRateMilliPercent ?? 0)} → {formatRate(row.newRateMilliPercent)}</p>
        <p className="text-sm text-muted-foreground">{row.kind === "REVIEW_REQUIRED" ? "Review required" : "Scheduled rate"} · Effective {row.effectiveFrom.toISOString().slice(0, 10)}</p>
        {row.kind === "REVIEW_REQUIRED" ? <>
          <p className="text-sm">Reasons: {row.reasons.join("; ")}</p>
          {owner && <TaxActionForm action={reviewOfficialRate} title="Owner review" submitLabel="Apply official observation">
            <input type="hidden" name="observationId" value={row.observationId} />
            <p className="text-xs">Applying a reviewed rate uses the existing official-rate safety and audit rules.</p>
          </TaxActionForm>}
        </> : row.undoAllowed && owner ? <TaxActionForm action={undoOfficialRate}
          title="Undo scheduled automatic rate" submitLabel="Undo automatic rate">
          <input type="hidden" name="rateVersionId" value={row.rateVersionId} />
        </TaxActionForm> : <p className="text-sm text-muted-foreground">Automatic undo not currently available under the effective-date guard.</p>}
      </div>)}
    </section>
    <section id="sources" className="space-y-3">
      <h3 className="font-semibold">Official source health</h3>
      <ul className="space-y-3">
        {sources.map(s => <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
          <p className="font-semibold">{s.label}: {s.active ? "Watching" : "Inactive"}</p>
          <p>Last checked: {s.lastCheckedAt?.toISOString().slice(0, 10) ?? "Never"} · Changes: {s.lastChangedAt?.toISOString().slice(0, 10) ?? "None recorded"}</p>
          <p>{s.url.startsWith("https://") ?
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">Open official source</a> :
            <span className="text-destructive">Source URL needs owner review</span>}</p>
          {s.lastExcerpt && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border p-2 text-xs">{s.lastExcerpt}</pre>}
          {s.lastError && <p role="status" className="text-destructive">Source unavailable: {s.lastError} ({s.consecutiveFailures} failures). Manual review required.</p>}
          {s.lastChangedAt && (!s.reviewedAt || s.lastChangedAt > s.reviewedAt) && <div className="mt-3">
            <p className="text-amber-700 dark:text-amber-300">Source changed; inspect the official link and the recorded excerpt before acknowledgement.</p>
            {owner && <TaxActionForm action={acknowledgeSource} title="Acknowledge reviewed source" submitLabel="Acknowledge change">
              <input type="hidden" name="watchId" value={s.id} />
              <input type="hidden" name="version" value={`${s.lastHash}:${s.lastChangedAt.getTime()}`} />
            </TaxActionForm>}
          </div>}
        </li>)}
      </ul>
    </section>
    <section id="jurisdictions" className="space-y-3">
      <h3 className="font-semibold">Tax jurisdictions and recorded rates</h3>
      <ul className="divide-y divide-border rounded border border-border">
        {jurisdictions.map(j => <li key={j.id} className="p-3 text-sm">
          <b>{j.name}</b> — {j.reviewStatus} · {j.rates[0] ? `${formatRate(j.rates[0].rateMilliPercent)} (since ${j.rates[0].effectiveFrom.toISOString().slice(0, 10)}, ${j.rates[0].source})` : "No rate recorded"}
        </li>)}
      </ul>
      <Link href="/desk/sales-tax/taxability" className="text-sm underline">Review owner-confirmed taxability and manual rate history</Link>
    </section>
  </main>;
}

