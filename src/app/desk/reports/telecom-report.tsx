import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/domains/pricing";
import { telecomReportPeriods } from "@/domains/messaging/telecom-periods";
import { getTelecomSpend } from "@/domains/messaging/telecom-costs-store";
import { communicationsPolicySchema } from "@/domains/messaging/communications-policy";
import { metricDefinition } from "@/domains/reports/definitions";
import { FORECAST_SCENARIOS, forecastSpend, getServiceMetrics, ratio } from "@/domains/messaging/telecom-unit-economics";

const DAY=86_400_000;
const tolerance={absoluteCents:0,percentBasisPoints:null,combination:"ANY" as const};
const windowGMT=telecomReportPeriods;
function money(cents:number|null, currency:string|null):string {
  return cents===null?"Unknown":currency==="USD"?formatCents(cents):currency?String(cents)+" cents "+currency:"Unknown currency";
}
function gmt(from:string,to:string) { return from+" through "+to+" (GMT)"; }
export async function TelecomReportSection({actorUserId}:{actorUserId:string}) {
  const now=new Date();
  const accounts=await prisma.telecomAccount.findMany({
    take:21,orderBy:[{createdAt:"asc"},{id:"asc"}],
    select:{id:true,label:true,status:true},
  });
  const settings=await prisma.businessSettings.findUnique({where:{id:"singleton"},
    select:{communicationsPolicy:true}});
  const policy=communicationsPolicySchema.safeParse(settings?.communicationsPolicy);
  const rules=policy.success?policy.data.telecomCostAlerts:undefined;
  const periods=windowGMT(now);
  const limited=accounts.length>20;
  const rows=await Promise.all(accounts.slice(0,20).map(async account=>{
    const current=await getTelecomSpend({
      accountId:account.id,actorUserId,periodStart:periods.current.start,
      periodEnd:periods.current.end,now,tolerance,alertRules:rules,
    });
    const previous=await getTelecomSpend({
      accountId:account.id,actorUserId,periodStart:periods.previous.start,
      periodEnd:periods.previous.end,now,tolerance,
    });
    return {label:account.label,current,previous};
  }));
  // Service numbers and cost per customer use the last complete month (the provider's totals for it are final enough to compare).
  const primary=policy.success?rows.find((_,i)=>accounts[i]?.id===policy.data.primaryAccountId):rows[0];
  const metricsFrom=periods.previous.start, metricsTo=periods.previous.end;
  const service=rows.length>0?await getServiceMetrics(actorUserId,metricsFrom,metricsTo).catch(()=>null):null;
  const prevTotal=primary?.previous.usage.complete?primary.previous.usage.accountTotalCents:null;
  const prevFixed=primary?.previous.usage.complete?primary.previous.usage.breakdownCents.FIXED??0:null;
  const perCustomer=service&&prevTotal!==null&&service.customers.complete?ratio(prevTotal,service.customers.averageDaily):null;
  const forecast=service&&primary?forecastSpend({totalCents:prevTotal,fixedCents:prevFixed,complete:service.customers.complete,
    customerDays:service.customers.customerDays,days:service.customers.days}):null;
  const pct=(v:number|null)=>v===null?"Not enough history":(v*100).toFixed(1)+"%";
  return <section aria-labelledby="telecom-report" className="mt-8 space-y-4">
    <div>
      <h2 id="telecom-report" className="text-xl font-semibold">Communications cost evidence</h2>
      <p className="mt-2 max-w-3xl text-sm text-ink-soft">
        {metricDefinition("telecom.reportedSpend").calculation}.
        Provider-reported charges are not finalized books. Estimated resource charges,
        provider usage, and verified statements are different evidence layers and
        must never be added together. No communications expense is posted here.
      </p>
      <Link href="/desk/settings/telecom" className="mt-2 inline-block text-sm underline">
        View provider setup and private statements
      </Link>
    </div>
    {service && <article aria-labelledby="telecom-service" className="rounded-card border border-line p-4">
      <h3 id="telecom-service" className="font-semibold">Service numbers and cost per customer</h3>
      <p className="text-xs text-ink-soft">Last full month, {gmt(service.window.fromGMT,service.window.throughGMT)}. Observed numbers only; where
        there is not enough history it says so instead of guessing.</p>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-medium">Text failure rate</dt><dd>{pct(service.texts.failureRate)}</dd>
          <dd className="text-xs text-ink-soft">{service.texts.delivered} delivered, {service.texts.failed} failed; {service.texts.pending} waiting and {service.texts.unknown} unknown are not counted.</dd></div>
        <div><dt className="font-medium">Opt-out (STOP) rate</dt><dd>{pct(service.optOuts.rate)}</dd>
          <dd className="text-xs text-ink-soft">{service.optOuts.count} of {service.optOuts.contacted} people texted.</dd></div>
        <div><dt className="font-medium">Median time to a person’s first reply</dt>
          <dd>{service.response.medianMinutes===null?"No replies to measure":Math.round(service.response.medianMinutes)+" minutes"}</dd>
          <dd className="text-xs text-ink-soft">Based on {service.response.samples} conversation{service.response.samples===1?"":"s"}; plain elapsed time, not business hours.</dd></div>
        <div><dt className="font-medium">Provider-reported spend per active customer</dt>
          <dd>{perCustomer===null?"Unavailable":money(Math.round(perCustomer),primary?.previous.usage.currency??null)}</dd>
          <dd className="text-xs text-ink-soft">{service.customers.complete
            ?`Average ${service.customers.averageDaily===null?"0":service.customers.averageDaily.toFixed(1)} active customers per day. Provider reported, not invoice reconciled.`
            :"Unavailable: some ended rentals have no recorded end time, so past customer counts cannot be trusted."}</dd></div>
      </dl>
      <h4 className="mt-4 text-sm font-semibold">What-if monthly spend</h4>
      {forecast&&forecast.available
        ?<>
          <ul className="mt-1 text-sm">{forecast.scenarios.map((sc)=><li key={sc.customers}>At {sc.customers.toLocaleString("en-US")} customers: about {money(sc.monthlyCents,primary?.previous.usage.currency??null)} a month</li>)}</ul>
          <p className="text-xs text-ink-soft">Based on {forecast.customerDays} customer-days and {money(forecast.fixedCents,primary?.previous.usage.currency??null)} of fixed charges counted once. {forecast.limitations.join(" ")}
            The customer counts ({FORECAST_SCENARIOS.join(", ")}) are examples, not goals.</p></>
        :<p className="text-sm text-ink-soft">{forecast?forecast.reason:"Unavailable."}</p>}
      <p className="mt-2 text-xs text-ink-soft">Cost as a share of rental revenue is not shown yet: it needs the recognized revenue in the accounting books for the same month.</p>
    </article>}
    {limited && <p className="text-sm text-warning-ink">Only the first 20 accounts are shown; this is not a company-wide total.</p>}
    {rows.length===0 && <p className="rounded border border-line p-4 text-sm">
      No telecom account recorded. Provider costs and budgets are unknown.
    </p>}
    {rows.map(({label,current,previous},i)=><article key={i} className="rounded-card border border-line p-4">
      <h3 className="font-semibold">{label}</h3>
      <p className="text-xs text-ink-soft">{gmt(current.period.fromGMT,current.period.throughGMT)}.
        Current incomplete month is compared with the prior full calendar month for context only,
        not a like-for-like growth rate.</p>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-medium">Provider-reported account total</dt>
          <dd>{money(current.usage.accountTotalCents,current.usage.currency)}</dd>
          <dd className="text-xs text-ink-soft">{current.usage.coverage} — provider observation, not invoice</dd></div>
        <div><dt className="font-medium">Previous full GMT month</dt>
          <dd>{money(previous.usage.accountTotalCents,previous.usage.currency)}</dd>
          <dd className="text-xs text-ink-soft">{previous.usage.coverage}</dd></div>
        <div><dt className="font-medium">Resource costs (separate evidence)</dt>
          <dd>{money(current.resources.providerReportedCents,current.resources.currency)}</dd>
          <dd className="text-xs text-ink-soft">Attributed {money(current.resources.providerAttributedCents,current.resources.currency)};
            unallocated {money(current.resources.providerUnallocatedCents,current.resources.currency)}</dd></div>
        <div><dt className="font-medium">Verified statement</dt>
          <dd>{money(current.statement.invoiceTotalCents,current.usage.currency)}</dd>
          <dd className="text-xs text-ink-soft">Evidence: {current.statement.state}.
            Differences are {current.reconciliation.differenceCents===null?"unknown":
              money(current.reconciliation.differenceCents,current.usage.currency)}.
            Not marked paid.</dd></div>
        <div><dt className="font-medium">Usage sync freshness</dt>
          <dd>{current.freshness.lastSuccessAt?
            current.freshness.lastSuccessAt.toISOString():"Never successfully synchronized"}</dd>
          <dd className="text-xs text-ink-soft">{current.freshness.lastErrorCode?"Latest fetch failed — prior evidence retained":"No reported fetch error"}</dd></div>
        <div><dt className="font-medium">Suggested budget warning remaining</dt>
          <dd>{current.alertPreview?.budgetRemainingCents===undefined ||
            current.alertPreview.budgetRemainingCents===null?
              "Unavailable — incomplete or stale evidence":
              money(current.alertPreview.budgetRemainingCents,current.usage.currency)}</dd>
          <dd className="text-xs text-ink-soft">Preview only. IN-53 approval pending; no alert dispatch or cutoff.</dd></div>
      </dl>
      {(current.usage.unknownCategories.length>0 || current.usage.incompleteComponents.length>0) &&
        <p className="mt-2 text-xs text-warning-ink">Unknown categories: {
          current.usage.unknownCategories.join(", ")||"none"}.
          Incomplete breakdown: {current.usage.incompleteComponents.join(", ")||"none"}.</p>}
    </article>)}
  </section>;
}
