"use client";
import { useState,useTransition } from "react";
import {setAgreementDeliveryOptionsAction} from "./delivery-offer-actions";
export function AgreementDeliveryOfferPanel({agreementId,initial,version,editable}:{
  agreementId:string;initial:Array<{date:string;window:"AM"|"PM"}>;
  version:number;editable:boolean;
}) {
  const [rows,setRows]=useState(initial.length?initial:[{date:"",window:"AM" as const}]);
  const [busy,start]=useTransition();
  const [notice,setNotice]=useState("");
  return <section className="space-y-3 rounded border border-line p-4">
    <h2 className="font-semibold">Offer customer delivery choices for this agreement</h2>
    <p className="text-sm text-ink-soft">1–4 dates, morning or afternoon. No customer self-booking.
      A signed payment must be verified before anyone can confirm the visit.</p>
    <p className="text-xs text-ink-soft">Offer version {version}</p>
    {rows.map((row,i)=><div key={i} className="flex flex-wrap gap-2">
      <label className="text-sm">Date <input type="date" value={row.date}
        disabled={!editable||busy} required className="rounded border border-line p-2"
        onChange={e=>setRows(v=>v.map((r,j)=>j===i?{...r,date:e.target.value}:r))}/></label>
      <label className="text-sm">Window <select disabled={!editable||busy}
        value={row.window} className="rounded border border-line p-2"
        onChange={e=>setRows(v=>v.map((r,j)=>j===i?{
          ...r,window:e.target.value as "AM"|"PM"}:r))}>
        <option value="AM">Morning</option><option value="PM">Afternoon</option>
      </select></label>
      {editable&&<button type="button" disabled={busy||rows.length===1}
        onClick={()=>setRows(v=>v.filter((_,j)=>j!==i))} className="underline">Remove</button>}
    </div>)}
    {editable&&<div className="flex gap-2">
      <button type="button" disabled={busy||rows.length===4}
        onClick={()=>setRows(v=>[...v,{date:"",window:"AM"}])}
        className="rounded border border-line px-3 py-2">Add choice</button>
      <button type="button" disabled={busy||rows.some(r=>!r.date)}
        onClick={()=>start(async()=>{
          const result=await setAgreementDeliveryOptionsAction(agreementId,rows);
          setNotice(result.ok?"Saved. Old selection versions are invalidated.":result.message);
        })} className="rounded bg-action px-3 py-2 text-on-action">Save choices</button>
    </div>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
