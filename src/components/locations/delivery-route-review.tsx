"use client";
import {useState,useTransition} from "react";
import {formatMoney} from "@/lib/money-ui";
import {reviewEstimateDrivingRouteAction,verifyDeliveryOriginAction} from
  "@/app/desk/estimates/[id]/delivery-offer-actions";
import {reviewAgreementDrivingRouteAction} from
  "@/app/desk/agreements/[id]/delivery-offer-actions";
export function DeliveryRouteReview({kind,id,origin,verified,feeCents,proofExists}:{
  kind:"estimate"|"agreement";id:string;origin:string;
  verified:boolean;feeCents:number|null;proofExists:boolean;
}) {
  const [busy,start]=useTransition();
  const [street,setStreet]=useState(verified?origin:"");
  const [originSource,setOriginSource]=useState("");
  const [miles,setMiles]=useState("");
  const [source,setSource]=useState("");
  const [message,setMessage]=useState("");
  return <section className="space-y-3 rounded border border-line p-3">
    <h3 className="font-medium">Owner-reviewed road route and signing fee</h3>
    <p className="text-sm text-ink-soft">No paid map calls or approximate ZIP distances.
      An actual road route, proof and matching tax-reviewed all-in signing total
      are required before a delivery choice can be accepted. Setting road miles
      never adds a charge automatically.</p>
    <p className="text-sm">Origin: {origin} — {verified?"verified":"NOT VERIFIED"}.
      {proofExists?" Route evidence recorded.":" Route evidence required."}
      {feeCents!==null?" Band fee: "+formatMoney(feeCents):""}</p>
    {!verified&&<form onSubmit={e=>{e.preventDefault();start(async()=>{
      const result=await verifyDeliveryOriginAction(street,originSource);
      setMessage(result.ok?"Origin verified. Refresh the page.":result.message);
    });}} className="space-y-2">
      <label className="block text-sm">Verified central Greeley street-level origin
        <input required minLength={15} value={street} onChange={e=>setStreet(e.target.value)}
          className="mt-1 w-full rounded border border-line p-2"/></label>
      <label className="block text-sm">Origin verification source
        <input required minLength={12} value={originSource} onChange={e=>setOriginSource(e.target.value)}
          className="mt-1 w-full rounded border border-line p-2"/></label>
      <button disabled={busy} className="rounded border border-line px-3 py-2">Verify origin</button>
    </form>}
    {verified&&<form onSubmit={e=>{e.preventDefault();start(async()=>{
      const value=Number(miles);
      const measuredAt=new Date().toISOString();
      const result=kind==="estimate"
        ?await reviewEstimateDrivingRouteAction(id,value,source,measuredAt,origin)
        :await reviewAgreementDrivingRouteAction(id,value,source,measuredAt,origin);
      setMessage(result.ok?"Reviewed band "+result.band+"; "+
        formatMoney(result.feeCents??0)+
        ". Confirm the frozen all-in charge matches before sending the agreement."
        :result.message);
    });}} className="space-y-2">
      <label className="block text-sm">Measured one-way driving miles
        <input type="number" required min={0} step={0.01} value={miles}
          onChange={e=>setMiles(e.target.value)} className="mt-1 w-full rounded border border-line p-2"/></label>
      <label className="block text-sm">Verified road-route evidence/reference
        <textarea required minLength={8} maxLength={500} value={source}
          onChange={e=>setSource(e.target.value)}
          className="mt-1 w-full rounded border border-line p-2"/></label>
      <button disabled={busy} className="rounded border border-line px-3 py-2">
        Save driving proof without billing</button>
    </form>}
    {message&&<p role="status" className="text-sm">{message}</p>}
  </section>;
}
