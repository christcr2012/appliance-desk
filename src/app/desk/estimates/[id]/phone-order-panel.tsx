"use client";
import {useState,useTransition} from "react";
import Link from "next/link";
import {recordPhoneOrderPreferenceAction,sendPhoneOrderToFinishAction,
  preparePhoneLeadCustomerAction}
  from "./phone-order-actions";
import type {DeliverySelection} from "@/domains/orders/delivery";

type Slot={id:string;date:string;window:"AM"|"PM"};
export function PhoneOrderPanel({id,status,enteredBy,recipient,slots,offerVersion,
  initial,siteReady,customerId,leadId}:{
  id:string;status:string;enteredBy:string;recipient:string|null;
  slots:Slot[];offerVersion:number;initial:DeliverySelection|null;
  siteReady:boolean;customerId:string|null;leadId:string|null;
}) {
  const [pending,start]=useTransition();
  const [selected,setSelected]=useState(initial?.expectedOfferVersion===offerVersion &&
    slots.some(x=>x.id===initial.optionId)?initial.optionId:slots[0]?.id??"");
  const [dryerOutlet,setDryerOutlet]=useState<"THREE_PRONG"|"FOUR_PRONG"|"GAS"|"UNKNOWN">(
    initial?.questions.dryerOutlet??"UNKNOWN");
  const [washerHookups,setWasherHookups]=useState<"YES"|"NO"|"UNKNOWN">(
    initial?.questions.washerHookups??"UNKNOWN");
  const [stairs,setStairs]=useState(initial?.questions.stairs??false);
  const [notes,setNotes]=useState(initial?.questions.crewNotes??"");
  const [notice,setNotice]=useState("");
  const [state,setState]=useState(status);
  const [hasPreference,setHasPreference]=useState(!!initial &&
    initial.expectedOfferVersion===offerVersion&&slots.some(x=>x.id===initial.optionId));
  const [result,setResult]=useState<null|{emailed:boolean;outcome:string}>(null);
  const editable=["DRAFT","CHANGES_REQUESTED"].includes(state);
  // Always use the exact same customer URL that existing estimate emails use.
  const href="/estimate/"+id;
  function selection():DeliverySelection{
    return {optionId:selected,expectedOfferVersion:offerVersion,
      questions:{dryerOutlet,washerHookups,stairs,crewNotes:notes}};
  }
  return <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
    <h2 className="font-semibold">Finish phone order with customer</h2>
    <p className="text-sm text-ink-soft">Entered by staff ID {enteredBy.slice(0,8)}
      · Customer email {recipient??"not yet entered"}.
      Record what they prefer, then the customer must review the full written
      offer independently, sign, pay and set their own password. Nothing spoken
      on a call is binding or charged.</p>
    {editable&&!customerId&&leadId&&<div className="space-y-2 rounded border border-line p-3">
      <p className="text-sm">New caller: prepare the standard customer account
        before adding the service address and rental lines. This does not email
        a password, accept a contract, charge a card or schedule a visit.</p>
      <button type="button" disabled={pending}
        onClick={()=>start(async()=>{
          const result=await preparePhoneLeadCustomerAction(id);
          setNotice(result.ok?"Customer record prepared. Add their address, machines and reviewed W-24 quote. Refresh the page to continue."
            :result.message);
        })} className="rounded border border-line px-3 py-2">
        Prepare customer record (not acceptance)
      </button>
    </div>}
    {editable&&<div className="space-y-3">
      {slots.length===0?<p role="status" className="text-sm">
        First save owner-offered AM/PM windows above; then record the caller&apos;s preference.</p>:
        <>
          <label className="block text-sm">Preferred offered delivery window
            <select value={selected} disabled={pending} onChange={e=>{
              setSelected(e.target.value);setHasPreference(false);
            }} className="mt-1 w-full rounded border border-line p-2">
              {slots.map(x=><option key={x.id} value={x.id}>{x.date} · {x.window}</option>)}
            </select></label>
          <label className="block text-sm">Dryer connection
            <select value={dryerOutlet} onChange={e=>{setDryerOutlet(e.target.value as typeof dryerOutlet);setHasPreference(false);}}
              className="mt-1 w-full rounded border border-line p-2">
              <option value="UNKNOWN">Unsure</option><option value="THREE_PRONG">3-prong</option>
              <option value="FOUR_PRONG">4-prong</option><option value="GAS">Gas</option>
            </select>
          </label>
          <label className="block text-sm">Washer hookups
            <select value={washerHookups} onChange={e=>{setWasherHookups(e.target.value as typeof washerHookups);setHasPreference(false);}}
              className="mt-1 w-full rounded border border-line p-2">
              <option value="UNKNOWN">Unsure</option><option value="YES">Available</option>
              <option value="NO">Not available</option>
            </select></label>
          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={stairs} onChange={e=>{setStairs(e.target.checked);setHasPreference(false);}}/>
            Stairs or difficult access
          </label>
          <label className="block text-sm">Crew access notes
            <textarea maxLength={1500} value={notes} onChange={e=>{setNotes(e.target.value);setHasPreference(false);}}
              className="mt-1 block w-full rounded border border-line p-2"/>
          </label>
          <button type="button" disabled={pending||!selected}
            onClick={()=>start(async()=>{
              const r=await recordPhoneOrderPreferenceAction(id,selection());
              setNotice(r.ok?"Preference recorded for the customer&apos;s independent review.":r.message);
              if(r.ok)setHasPreference(true);
            })} className="rounded border border-line px-3 py-2">
            Save caller&apos;s preference (not acceptance)
          </button>
        </>}
    </div>}
    <div className="flex flex-wrap gap-2">
      {editable&&<button type="button" disabled={pending||!hasPreference||!siteReady}
        onClick={()=>start(async()=>{
          const r=await sendPhoneOrderToFinishAction(id);
          if(r.ok){
            setState("SENT");setResult({emailed:r.emailed,outcome:r.outcome});
            setNotice(r.emailed?"Customer email accepted by delivery provider.":
              r.outcome==="NOT_ATTEMPTED"?
                "Email is OFF. No email was attempted; copy the link manually.":
                "Email delivery unconfirmed. Inspect status before any resend.");
          }else setNotice(r.message);
        })} className="rounded bg-action px-3 py-2 text-on-action">
        Send to finish (existing secured email gate)
      </button>}
      <button type="button" disabled={pending||!["SENT","VIEWED","APPROVED","CONVERTED"].includes(state)}
        onClick={()=>navigator.clipboard.writeText(location.origin+href)
          .then(()=>setNotice("Copied exact customer link. Share using your own phone only; app SMS stays OFF."))
          .catch(()=>setNotice("Copy this customer address: "+location.origin+href))}
        className="rounded border border-line px-3 py-2">Copy same customer link</button>
      <Link href="/desk/phone-orders" className="rounded border border-line px-3 py-2">All phone orders</Link>
    </div>
    {!siteReady&&editable&&<p className="text-sm text-ink-soft" role="status">
      Enter all machines, complete frozen all-in tax and driving-route reviews, and
      prepare the W-24 single-site order before sending. No draft may be sent as binding.</p>}
    {result&&<p className="text-xs text-ink-soft">Email outcome: {result.outcome};
      accepted by provider: {String(result.emailed)}. This is not proof of inbox receipt.</p>}
    {notice&&<p role="status" className="text-sm">{notice}</p>}
  </section>;
}
