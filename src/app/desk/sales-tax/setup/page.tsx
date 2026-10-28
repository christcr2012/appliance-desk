import Link from "next/link";
import { Money, MoneyInput } from "@/components/ui/money";
import { InfoTip } from "@/components/ui/info-tip";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { TaxActionForm } from "./forms";
import { TAXES_SETUP_LINKS } from "@/lib/taxes-tabs";
import { ruleAsOf } from "@/domains/rules/reads";
import { businessDateKey } from "@/lib/business-date";
import { addRdfRateAction, saveTaxAccountAction, saveTaxSettingsAction, lookUpBusinessTaxAreasAction, confirmBusinessTaxAreasAction } from "./actions";
import { greeleyFeeEmailDraft } from "@/domains/tax/greeley-email";
const css = "w-full rounded border border-input bg-background p-2 text-sm";
const field = "grid gap-1 text-sm font-medium";
export default async function TaxSetupPage() {
  const session = await requireRole("OWNER", "ADMIN");
  const owner = session.user.role === "OWNER";
  const [settings, accounts, rates, rdfThresholdCents, sources, businessLocation, knownAreas, rdfLock, complianceProfile] = await Promise.all([
    prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{
      updatedAt:true,shortTermLeaseElection:true,shortTermLeaseElectionNote:true,
      rdfHandling:true,rdfCpaConfirmedOn:true,
      autoApplyOfficialRateChanges:true,autoRateChangeMaxMilliPercent:true,businessTaxAddress:true,
    }}),
    prisma.taxFilingAccount.findMany({orderBy:[{kind:"asc"},{name:"asc"}],take:70,
      select:{id:true,name:true,kind:true,basis:true,frequency:true,active:true,accountNumber:true,firstPeriodStart:true}}),
    // TFA-1: recorded fee rates are dated rule versions, not rate-table rows.
    prisma.legalRuleVersion.findMany({where:{ruleKey:"co.rdf.amount",undoneAt:null},
      orderBy:{effectiveFrom:"desc"},take:10,select:{id:true,effectiveFrom:true,value:true}}),
    ruleAsOf<number>("co.rdf.qualified_threshold", new Date()).then(r => r.value),
    prisma.officialSourceWatch.findMany({orderBy:{createdAt:"asc"},take:30}),
    prisma.addressTaxLocation.findFirst({
      where: { forBusinessLocation: true, isCurrent: true },
      include: { jurisdictions: { include: { jurisdiction: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.taxJurisdiction.findMany({
      select: { id: true, name: true, level: true, reviewStatus: true },
      orderBy: [{ level: "asc" }, { name: "asc" }], take: 200,
    }),
    // TFA-2 §6.7: who pays locked from the first sale the fee applied to.
    prisma.retailDeliveryFeeRecord.findFirst({
      where: { status: { in: ["READY", "PENDING_RATE"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true },
    }),
    // FEETAX-1: the legal business name signs the drafted Greeley email.
    prisma.complianceProfile.findFirst({ select: { businessLegalName: true } }),
  ]);
  const address = settings.businessTaxAddress && typeof settings.businessTaxAddress==="object" &&
    !Array.isArray(settings.businessTaxAddress) ? settings.businessTaxAddress as Record<string,unknown> : {};
  return <main className="space-y-7">
    {!owner && <p role="status" className="rounded border border-border p-3">Read only. Ask the owner to approve changes to tax setup.</p>}
    <section aria-labelledby="more-setup" className="space-y-2">
      <h2 id="more-setup" className="text-lg font-semibold">All tax setup in one list</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {TAXES_SETUP_LINKS.filter(item => !item.href.endsWith("/setup")).map(item => <li key={item.href} className="rounded-lg border border-border bg-card p-3 text-sm">
          <Link href={item.href} className="font-semibold underline">{item.label}</Link>
          <p className="text-muted-foreground">{item.detail}</p>
        </li>)}
      </ul>
    </section>
    <nav aria-label="Setup sections" className="flex flex-wrap gap-3 text-sm underline">
      <a href="#decisions">Tax decisions</a><a href="#fee">Delivery fee</a>
      <a href="#accounts">Filing accounts</a><a href="#sources">Official sources</a>
      <a href="#location">Business location</a>
    </nav>
    {owner ? <TaxActionForm action={saveTaxSettingsAction} title="Tax decisions and owner setup">
      <input type="hidden" name="expectedUpdatedAt" value={settings.updatedAt.toISOString()} />
      <section id="decisions" className="grid gap-4 md:grid-cols-2">
        <label className={field}>Short-term lease election
          <select name="shortTermLeaseElection" defaultValue={settings.shortTermLeaseElection} className={css}>
            <option value="UNDECIDED">Ask CPA</option><option value="PAY_ON_ACQUISITION">Pay acquisition tax</option>
            <option value="COLLECT_ON_RENTALS">Tax rental payments</option>
          </select>
        </label>
        <label className={field}>CPA decision notes
          <textarea name="shortTermLeaseElectionNote" maxLength={500} rows={2} className={css} defaultValue={settings.shortTermLeaseElectionNote ?? ""} />
        </label>
      </section>
      <fieldset id="fee" className="rounded border border-border p-3 space-y-3">
        <legend className="font-semibold">Colorado retail delivery fee</legend>
        <p className="text-sm text-muted-foreground">These decisions do not enable live charges. Confirm with your CPA before saving.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <label className={field}>Who pays<select name="rdfHandling" className={css} defaultValue={settings.rdfHandling} disabled={!!rdfLock}>
            <option value="UNDECIDED">Undecided</option><option value="COLLECT_FROM_CUSTOMER">Customer</option><option value="PAY_MYSELF">Business</option>
          </select></label>
          <label className={field}>Delivery fee threshold ($) <InfoTip term="rdf-threshold" /><MoneyInput name="rdfThresholdDollars" cents={rdfThresholdCents} className={css} /></label>
          <label className={field}>CPA confirmed on<input name="rdfCpaConfirmedOn" type="date" className={css} defaultValue={settings.rdfCpaConfirmedOn?.toISOString().slice(0,10)} /></label>
        </div>
        {rdfLock && <p role="status" className="text-sm">Locked since {businessDateKey(rdfLock.createdAt)}: the fee already applies to a sale, so who pays can&rsquo;t change. Your CPA reviews it before January 1.</p>}
      </fieldset>
      <fieldset className="space-y-2 rounded border border-border p-3">
        <legend className="font-semibold">Official rate updates</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoApplyOfficialRateChanges" defaultChecked={settings.autoApplyOfficialRateChanges} />Apply eligible reviewed rate updates within the limit</label>
        <p className="text-sm text-muted-foreground">Off: every new rate waits for your approval on To do. This starts off — turn it on only if you want reviewed rate updates applied on their own, within the limit below. Greeley&rsquo;s own rate always waits for your approval either way.</p>
        <label className={field}>Maximum change (milli-percent)<input name="autoRateChangeMaxMilliPercent" type="number" min={0} max={100000} className={css} defaultValue={settings.autoRateChangeMaxMilliPercent} required /></label>
      </fieldset>
      <fieldset id="location" className="space-y-2 rounded border border-border p-3">
        <legend className="font-semibold">Internal business tax location</legend>
        <p className="text-sm text-muted-foreground">Private financial location, not a public contact address.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {(["line1","city","state","zip"] as const).map(key => <label className={field} key={key}>{key}
            <input name={key} className={css} maxLength={120} defaultValue={typeof address[key]==="string" ? String(address[key]):""} />
          </label>)}
        </div>
      </fieldset>
    </TaxActionForm> : <section id="decisions" className="rounded border p-4"><h2 className="font-semibold">Tax decisions</h2>
      <p>Lease treatment: {settings.shortTermLeaseElection}</p><p>RDF handling: {settings.rdfHandling}</p>
      <p>CPA confirmation: {settings.rdfCpaConfirmedOn?.toISOString().slice(0,10) ?? "Pending"}</p>
    </section>}
    <section id="business-tax-address" className="rounded border border-border p-4 space-y-3">
      <h2 className="font-semibold">Your business address (for tax on things you buy)</h2>
      <p className="text-sm">Saved privately: {[address.line1, address.city, address.state, address.zip]
        .filter(v => typeof v === "string" && v.trim()).join(", ") || "No address entered yet"}</p>
      <p role="status" className="text-sm font-medium">
        {businessLocation?.status === "VERIFIED"
          ? "Confirmed: " + businessLocation.jurisdictions.map(row => row.jurisdiction.name).join(", ")
          : "Not confirmed yet"}
      </p>
      {businessLocation?.status !== "VERIFIED" &&
        <p className="text-sm text-muted-foreground">Look up and confirm again after changing the address. Purchase tax waits until the location is confirmed.</p>}
      {businessLocation?.reviewNote && <p className="text-sm">{businessLocation.reviewNote}</p>}
      <p className="text-sm text-muted-foreground">Use the saved private business address above. Verify the areas before confirming; a lookup is not legal approval.</p>
      <TaxActionForm action={lookUpBusinessTaxAreasAction} title="Find the tax areas for this address" submitLabel="Look up tax areas">
        <p className="text-sm">Look up areas for this business location using the configured source.</p>
      </TaxActionForm>
      <TaxActionForm action={confirmBusinessTaxAreasAction} title="Confirm these tax areas" submitLabel="Confirm these tax areas">
        <fieldset className="grid gap-2">
          <legend className="text-sm">Choose the tax areas that apply to your business address.</legend>
          {knownAreas.map(area => <label key={area.id} className="flex gap-2 text-sm items-start">
            <input type="checkbox" name="jurisdictionIds" value={area.id}
              defaultChecked={businessLocation?.jurisdictions.some(j => j.jurisdictionId === area.id) ?? false}/>
            <span>{area.name} ({area.level.toLowerCase().replaceAll("_", " ")})
              {area.reviewStatus !== "REVIEWED" ? " — rate review still needed" : ""}</span>
          </label>)}
          {!knownAreas.length && <p className="text-sm">No areas on record yet. Use the lookup above first.</p>}
        </fieldset>
      </TaxActionForm>
    </section>
    <section id="greeley-email" className="rounded border border-border p-4 space-y-3">
      <h2 className="font-semibold">Email Greeley — ask how rentals and fees are taxed</h2>
      <p className="text-sm text-muted-foreground">Greeley collects its own tax and its answers for rentals and service fees are not published, so the app taxes them until Greeley confirms in writing. This draft asks the three open questions. The app never sends it — the button opens the draft in your own email app so their reply comes to you.</p>
      {(() => { const draft = greeleyFeeEmailDraft(complianceProfile?.businessLegalName ?? ""); return <>
        <p className="text-sm">To: {draft.to}</p>
        <p className="text-sm">Subject: {draft.subject}</p>
        <pre className="whitespace-pre-wrap rounded border border-border bg-card p-3 text-sm">{draft.body}</pre>
        <p><a className="font-semibold underline" href={draft.mailto}>Open the draft in your email app</a></p>
      </>; })()}
      <p className="text-sm text-muted-foreground">When the written reply arrives, record the answers on Taxes › Rules — the questions FEETAX-GREELEY-LEASE, FEETAX-GREELEY-SERVICE and FEETAX-GREELEY-OTHER then show as confirmed.</p>
    </section>
    <section id="fee-rates" className="space-y-3">
      <h2 className="font-semibold">Recorded fee rates</h2>
      <ul className="space-y-1 text-sm">{rates.map(rate => <li key={rate.id}>{rate.effectiveFrom.toISOString().slice(0,10)} — <Money cents={typeof rate.value === "number" ? rate.value : 0} /></li>)}</ul>
      {owner && <TaxActionForm action={addRdfRateAction} title="Add a July 1 statutory fee rate" submitLabel="Record rate">
        <div className="grid gap-3 md:grid-cols-2">
          <label className={field}>Effective July 1<input className={css} name="effectiveOn" type="date" required /></label>
          <label className={field}>Fee amount ($) <InfoTip term="rdf-rate" /><MoneyInput name="amountDollars" cents={0} className={css} /></label>
        </div>
      </TaxActionForm>}
    </section>
    <section id="accounts" className="space-y-3">
      <h2 className="font-semibold">Filing accounts</h2>
      <p className="text-sm text-muted-foreground">Incomplete setup stays visible and never invents your license number or CPA answers.</p>
      <ul className="divide-y divide-border rounded border border-border">{accounts.map(a => <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
        <span>{a.name} — {a.kind.replaceAll("_"," ")} · {a.frequency} · {a.active ? "Active":"Inactive"} · {a.accountNumber ? "Number recorded":"Needs number"} · {a.firstPeriodStart ? "Period set":"Period missing"}</span>
        <Link className="underline" href={`/desk/sales-tax/setup/accounts/${a.id}`}>Open account</Link></li>)}</ul>
      {owner && <TaxActionForm title="Add filing account" action={saveTaxAccountAction}>
        <label className={field}>Name<input className={css} name="name" maxLength={100} required /></label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className={field}>Return type<select name="kind" className={css}><option value="SALES_RETURN">Sales</option><option value="USE_TAX_RETURN">Use tax</option><option value="RETAIL_DELIVERY_FEE_RETURN">RDF</option></select></label>
          <label className={field}>Frequency<select name="frequency" className={css}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option></select></label>
          <label className={field}>Basis<select name="basis" className={css}><option value="UNDECIDED">Ask CPA</option><option value="CASH">Cash</option><option value="ACCRUAL">Accrual</option></select></label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={field}>Account number<input name="accountNumber" className={css} /></label>
          <label className={field}>Official filing URL (HTTPS)<input name="portalUrl" type="url" className={css} /></label>
          <label className={field}>First filing period<input name="firstPeriodStart" type="date" className={css} /></label>
          <label className={field}>Due day<input name="dueDayOfFollowingMonth" type="number" defaultValue={20} min={1} max={31} className={css} /></label>
          <label className={field}>Reminder days before (comma separated)<input name="reminderDaysBefore" defaultValue="7,2" className={css} /></label>
        </div>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="active" defaultChecked /> Active</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="emailReminders" defaultChecked /> Email reminders</label>
        <label className={field}>Filing notes<textarea name="filingNotes" className={css} maxLength={1000} /></label>
      </TaxActionForm>}
    </section>
    <section id="sources" className="space-y-2">
      <h2 className="font-semibold">Official sources</h2>
      <p className="text-sm text-muted-foreground">A source check does not automatically confirm a tax decision. Open Areas for official rate review, undo and source acknowledgements.</p>
      <ul className="space-y-2 text-sm">{sources.map(source => <li key={source.id} className="rounded border border-border p-3">
        <b>{source.label}</b> — {source.active ? "Watching":"Inactive"}, last checked {source.lastCheckedAt?.toISOString().slice(0,10) ?? "never"}
        {source.lastError && <p role="status" className="text-destructive">Source failure: {source.lastError}</p>}
      </li>)}</ul>
    </section>
  </main>;
}

