"use client";
import {useState,useTransition} from "react";
import {formatMoney} from "@/lib/money-ui";
import {useRouter} from "next/navigation";
import {approveW24FeeAction,queueApprovedW24FeeAction} from "./w24-fee-actions";
export function W24JobFeePanel({jobId,version,kind,configuredCents,approvedCents,eligible,alreadyQueued}:{
  jobId:string;version:number;kind:"MISSED_TRIP"|"RELOCATION";
  configuredCents:number;approvedCents:number;eligible:boolean;alreadyQueued:boolean;
}){
  const [proof,setProof]=useState("");
  const [busy,start]=useTransition();
  const [message,setMessage]=useState("");
  const router=useRouter();
  return <section className="space-y-2 rounded border border-line p-4">
    <h3 className="font-semibold">{kind==="MISSED_TRIP"?"Missed-trip fee":"Single relocation fee"}</h3>
    <p className="text-sm text-ink-soft">Default is OFF for missed trips ($0).
      An owner must independently review actual evidence; no service swap or automatic charge.
      Next-invoice posting requires a separate TEST-only and tax-reviewed provider gate.</p>
    <p className="text-sm">Configured: {formatMoney(configuredCents)}.
      Approved: {formatMoney(approvedCents)}.
      {alreadyQueued?" Provider intent already recorded.":""}</p>
    {eligible&&approvedCents===0&&configuredCents>0&&<form onSubmit={e=>{
      e.preventDefault();start(async()=>{
        const result=await approveW24FeeAction(jobId,kind,proof,version);
        setMessage(result.ok?"Owner approval recorded. Nothing billed yet.":result.message);
        if(result.ok)router.refresh();
      });
    }} className="space-y-2">
      <label className="block text-sm">Owner&apos;s per-job documented reason
        <textarea required minLength={16} maxLength={500} value={proof}
          onChange={e=>setProof(e.target.value)} className="mt-1 w-full rounded border border-line p-2"/></label>
      <button disabled={busy} className="rounded border border-line px-3 py-2">
        Approve once without billing</button>
    </form>}
    {approvedCents>0&&!alreadyQueued&&<button type="button" disabled={busy}
      onClick={()=>start(async()=>{
        const result=await queueApprovedW24FeeAction(jobId,kind);
        setMessage(result.message);if(result.ok)router.refresh();
      })} className="rounded border border-line px-3 py-2">Review gated next-invoice posting</button>}
    {message&&<p role="status" className="text-sm">{message}</p>}
  </section>;
}
