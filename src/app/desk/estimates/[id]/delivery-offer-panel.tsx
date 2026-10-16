"use client";
import { useState,useTransition } from "react";
import { setEstimateDeliveryOptionsAction } from "./delivery-offer-actions";
export function DeliveryOfferPanel({estimateId,options,editable,version,autoFinishEnabled=false}:{
  estimateId:string;options:Array<{date:string;window:"AM"|"PM"}>;
  editable:boolean;version:number;autoFinishEnabled?:boolean;
}) {
  const [rows,setRows]=useState(options.map(x=>({date:x.date,window:x.window})));
  const [pending,start]=useTransition();
  const [autoFinish,setAutoFinish]=useState(autoFinishEnabled);
  const [notice,setNotice]=useState("");
  const url = typeof window === "undefined" ? "/estimate/"+estimateId :
    window.location.origin+"/estimate/"+estimateId;
  return <section className="space-y-3 rounded-lg border border-line p-4">
    <h2 className="font-semibold">Owner-offered delivery windows</h2>
    <p className="text-sm text-ink-soft">
      Offer up to four choices; a customer can request one, but only you or authorized
      staff can confirm an actual delivery. The customer cannot pick from an open calendar.
    </p>
    <p className="text-xs text-ink-soft">Offer version {version}</p>
    <ul className="space-y-2">
      {rows.map((row,i)=><li key={i} className="flex flex-wrap gap-2">
        <label className="text-sm">Date
          <input type="date" disabled={!editable||pending} required value={row.date}
            onChange={e=>setRows(prev=>prev.map((r,j)=>j===i?{...r,date:e.target.value}:r))}
            className="ml-2 rounded border border-line p-2"/>
        </label>
        <label className="text-sm">Window
          <select disabled={!editable||pending} value={row.window}
            onChange={e=>setRows(prev=>prev.map((r,j)=>j===i?{...r,window:e.target.value as "AM"|"PM"}:r))}
            className="ml-2 rounded border border-line p-2">
            <option value="AM">Morning</option><option value="PM">Afternoon</option>
          </select>
        </label>
        {editable&&<button disabled={pending||rows.length<=1}
          onClick={()=>setRows(prev=>prev.filter((_,j)=>i!==j))}
          className="underline text-sm">Remove</button>}
      </li>)}
    </ul>
    {editable && <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={autoFinish} onChange={e=>setAutoFinish(e.target.checked)}/>
      Authorize prepared single-property offers to continue through signing without
      a second manual conversion. Multiple-property, unfrozen or unreviewed
      orders still stop for explicit owner review.
    </label>}
    {editable && <div className="flex flex-wrap gap-2">
      <button type="button" disabled={pending||rows.length>=4}
        onClick={()=>setRows(prev=>[...prev,{date:"",window:"AM"}])}
        className="rounded border border-line px-3 py-2 text-sm">Add choice</button>
      <button type="button" disabled={pending||rows.length<1||rows.some(row=>!row.date)}
        onClick={()=>start(async()=>{
          const reply=await setEstimateDeliveryOptionsAction(estimateId,rows,autoFinish);
          setNotice(reply.ok?"Saved; old customer choice versions are invalidated.":reply.message);
        })} className="rounded bg-action px-3 py-2 text-sm text-on-action">
        Save offered windows</button>
    </div>}
    <button type="button" className="rounded border border-line px-3 py-2 text-sm"
      onClick={()=>navigator.clipboard.writeText(url).then(()=>setNotice("Customer link copied."))
        .catch(()=>setNotice("Copy this address: "+url))}>Copy exact customer link</button>
    {notice&&<p role="status" className="text-sm">{notice}</p>}
  </section>;
}
