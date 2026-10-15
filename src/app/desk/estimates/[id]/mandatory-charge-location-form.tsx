"use client";

import { useActionState } from "react";
// Client-safe formatter: the pricing domain index also imports Prisma.
const formatCents=(cents:number)=>new Intl.NumberFormat("en-US",{
  style:"currency",currency:"USD",
}).format(cents/100);
import type { PreparedMandatoryChargeOverview } from
  "@/domains/estimates/mandatory-charge-allocation";
import { saveMandatoryChargeReviewAction } from "./mandatory-charge-action";

const services=[
  {key:"delivery",label:"Delivery service"},
  {key:"installation",label:"Installation / hookup service"},
  {key:"removal",label:"Removal service"},
  {key:"damageWaiver",label:"Damage waiver (requires consent/terms)"},
] as const;

export function MandatoryChargeLocationReviewForm({overview,owner}:{
  overview:PreparedMandatoryChargeOverview;owner:boolean;
}){
  const [status,action,pending]=useActionState(
    saveMandatoryChargeReviewAction,{success:"",error:""});
  const available=owner&&overview.canReview&&overview.globalPolicyRevision!==null;
  return <section className="mt-5 rounded-lg border border-line bg-surface p-4 text-sm"
    aria-labelledby="mandatory-services-title">
    <h2 id="mandatory-services-title" className="font-semibold">
      Service, tax and Colorado delivery fee review — all locations
    </h2>
    <p className="mt-2 text-ink-soft">Every address needs its own explicit
      decision. Required charges come from owner settings, never amounts
      entered in the browser. A documented exception is necessary when a
      generally required service will not be performed. Calculated local tax
      and any Colorado retail delivery fee are reviewed separately. All
      results remain private planning until the complete signed financial
      evidence and legal/CPA gates are satisfied.</p>
    <p className="mt-2">Effective owner policy revision: {overview.globalPolicyRevision??"missing"}.</p>
    {overview.problems.length>0&&<div className="mt-3 border-l-2 border-amber-500 pl-3">
      <p className="font-medium">Remaining review or source changes</p>
      <ul className="list-inside list-disc text-ink-soft">
        {overview.problems.map(item=><li key={item}>{item}</li>)}
      </ul>
    </div>}
    <form action={action} className="mt-3 space-y-3">
      <input name="estimateId" type="hidden" value={overview.estimateId}/>
      <input name="estimateUpdatedAt" type="hidden" value={overview.estimateUpdatedAt}/>
      <input name="globalRevision" type="hidden" value={overview.globalPolicyRevision??""}/>
      <input name="settingsUpdatedAt" type="hidden" value={overview.settingsUpdatedAt??""}/>
      {overview.locations.map((loc,i)=><fieldset key={loc.agreementId}
        className="space-y-2 rounded border border-line p-3">
        <legend className="px-1 font-medium">{loc.addressLabel}</legend>
        <input name="agreementId" type="hidden" value={loc.agreementId}/>
        <input name={"revision_"+i} type="hidden" value={loc.revision??""}/>
        <p className="text-xs text-ink-soft">Original review version:
          {loc.revision??"not recorded"}. No collection has been authorized.</p>
        {services.map(({key,label})=><div key={key}
          className="grid gap-1 border-b border-line pb-2">
          <label className="grid gap-1">
            <span>{label} — global: {overview.globalDecisions[key]}</span>
            <select disabled={!available||pending||overview.globalDecisions[key]==="UNDECIDED"}
              className="w-full rounded border border-line bg-surface p-2"
              name={key+"_"+i} defaultValue={loc.decisions[key]}>
              <option value="REQUIRED">Required for this property</option>
              <option value="NOT_APPLICABLE">Not applicable (reason if exception)</option>
            </select>
          </label>
          <label className="grid gap-1">
            Reason when generally required service is not applicable
            <textarea name={key+"_reason_"+i} rows={2} maxLength={500}
              defaultValue={loc.exceptionReasons[key]??""}
              disabled={!available||pending}
              className="w-full rounded border border-line bg-surface p-2"/>
          </label>
        </div>)}
        <dl className="grid gap-2 sm:grid-cols-3">
          <div><dt>Known reviewed service fees</dt>
            <dd>{formatCents(loc.knownServiceFeesCents)}</dd></div>
          <div><dt>Provisional service tax</dt>
            <dd>{loc.taxCents===null?"Needs tax review":formatCents(loc.taxCents)}</dd></div>
          <div><dt>Colorado RDF event allocation</dt>
            <dd>{loc.retailDeliveryCents===null?"Needs RDF review":
              formatCents(loc.retailDeliveryCents)}</dd></div>
        </dl>
        {loc.problems.map(msg=><p key={msg} className="text-ink-soft">{msg}</p>)}
      </fieldset>)}
      <label className="grid gap-1">
        Colorado retail delivery fee: assign one reviewed qualifying event
        <select name="rdfAgreementId" disabled={!available||pending}
          defaultValue={overview.locations.find(row=>row.retailDeliveryEvent)?.agreementId??""}
          className="w-full rounded border border-line bg-surface p-2">
          <option value="">No fee event (only when independently exempt)</option>
          {overview.locations.map(loc=><option key={loc.agreementId}
            value={loc.agreementId}>{loc.addressLabel}</option>)}
        </select>
      </label>
      <p className="text-xs text-ink-soft">RDF is not multiplied by appliance or
        tax jurisdiction. Selecting an event here is provisional, not legal
        approval or an automatic customer charge.</p>
      <label className="grid gap-1">
        Owner reason for reviewing all affected addresses
        <textarea name="reason" rows={2} minLength={12} maxLength={500}
          required disabled={!available||pending}
          className="w-full rounded border border-line bg-surface p-2"/>
      </label>
      {available&&<button type="submit" disabled={pending}
        className="rounded bg-action px-4 py-2 font-medium text-on-action disabled:opacity-50">
        {pending?"Reviewing and recording…":"Record reviewed location fee policy"}
      </button>}
      {!owner&&<p>Only the OWNER may change mandatory charge decisions.</p>}
      {!overview.canReview&&<p>Only an editable, unfunded prepared estimate may be reviewed.</p>}
      {!overview.globalPolicyRevision&&<p>First configure and date an owner global policy.</p>}
      {status.error&&<p role="alert" className="text-red-700">{status.error}</p>}
      {status.success&&<p role="status">{status.success}</p>}
    </form>
  </section>;
}
