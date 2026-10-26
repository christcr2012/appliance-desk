"use client";
import { useState } from "react";
import Link from "next/link";
import { startBooksWizardAction } from "./actions";
const input="block w-full min-h-11 rounded border border-border bg-background px-3 py-2";
const btn="min-h-11 rounded border border-border px-4 py-2 font-semibold";
const steps=["Business start date","Opening balances","Personal spending","Review"];
export function BooksSetupWizard({recommendedDate}:{recommendedDate:string}){
 const [step,setStep]=useState(0);
 const [startDate,setDate]=useState(recommendedDate);
 const [newBusiness,setNew]=useState(true);
 const [bank,setBank]=useState("0.00");
 const [stripe,setStripe]=useState("0.00");
 const [card,setCard]=useState("0.00");
 return <form action={startBooksWizardAction} className="space-y-6">
  <ol className="flex gap-2 flex-wrap" aria-label="Books setup steps">
   {steps.map((name,i)=><li key={name} aria-current={step===i?"step":undefined}
     className={`rounded border px-3 py-2 text-sm ${step===i?"border-primary font-bold":"border-border"}`}>
     {i+1}. {name}
   </li>)}
  </ol>
  <input type="hidden" name="startDate" value={startDate}/>
  <input type="hidden" name="newBusiness" value={newBusiness?"yes":"no"}/>
  <input type="hidden" name="bank" value={newBusiness?"0.00":bank}/>
  <input type="hidden" name="stripe" value={newBusiness?"0.00":stripe}/>
  <input type="hidden" name="card" value={newBusiness?"0.00":card}/>
  {step===0&&<section className="space-y-3">
   <h2 className="text-xl font-bold">When did the business start doing business?</h2>
   <label className="block">Your starting date (Colorado)
    <input type="date" className={input} value={startDate} max={new Date().toISOString().slice(0,10)}
      onChange={e=>setDate(e.target.value)} required/>
   </label>
   <p className="text-sm text-muted-foreground">Pick the first day you want your records to cover. Most new businesses use the day the LLC was formed or the day they bought their first appliance. This date is only a suggestion until you confirm it.</p>
  </section>}
  {step===1&&<section className="space-y-3">
   <h2 className="text-xl font-bold">Is this a brand-new business with nothing in its accounts yet?</h2>
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="rounded border border-border p-4 cursor-pointer"><input type="radio" checked={newBusiness}
     onChange={()=>setNew(true)}/> <strong>Yes (recommended)</strong><p className="text-sm">Starting balances are all $0.</p></label>
    <label className="rounded border border-border p-4 cursor-pointer"><input type="radio" checked={!newBusiness}
     onChange={()=>setNew(false)}/> <strong>No</strong><p className="text-sm">I already had money or card debt in the business.</p></label>
   </div>
   {!newBusiness&&<div className="grid gap-3 sm:grid-cols-3">
    <label>Business checking on that day ($)<input className={input} inputMode="decimal" value={bank}
      onChange={e=>setBank(e.target.value)} required/><small>Bank statement ending balance.</small></label>
    <label>Stripe balance on that day ($)<input className={input} inputMode="decimal" value={stripe}
      onChange={e=>setStripe(e.target.value)} required/><small>Stripe Dashboard → Balances.</small></label>
    <label>Business credit card owed on that day ($)<input className={input} inputMode="decimal" value={card}
      onChange={e=>setCard(e.target.value)} required/><small>Credit card statement balance.</small></label>
   </div>}
  </section>}
  {step===2&&<section className="space-y-3">
   <h2 className="text-xl font-bold">Did you pay for anything for the business with personal money?</h2>
   <p>That counts as money you put into the business. You can record the purchase as an expense paid from Owner contributions.</p>
   <Link href="/desk/expenses?paidFrom=owner#add-expense" className="inline-block rounded border border-border px-4 py-2">
    Add those expenses
   </Link>
   <p className="text-sm text-muted-foreground">Or choose Skip for now below. You can enter those expenses at any time.</p>
  </section>}
  {step===3&&<section className="space-y-4">
   <h2 className="text-xl font-bold">Ready to start your books?</h2>
   <p>Business start date: <strong>{startDate}</strong>.</p>
   {newBusiness?<p>Starting checking, Stripe and card debt: <strong>$0.00</strong> each.</p>:
    <dl className="grid grid-cols-2 gap-2">
     <dt>Checking</dt><dd className="text-right">$ {bank}</dd>
     <dt>Stripe</dt><dd className="text-right">$ {stripe}</dd>
     <dt>Credit card owed</dt><dd className="text-right">$ {card}</dd>
    </dl>}
   <p className="text-sm text-muted-foreground">Appliance Desk will start recording past and future entries. You can correct these starting balances later; the original entry is always kept. No money is moved and no payment is sent.</p>
  </section>}
  <div className="flex items-center gap-3 justify-between border-t border-border pt-4">
   {step>0?<button type="button" className={btn} onClick={()=>setStep(step-1)}>Back</button>:<span/>}
   {step<3?<button type="button" className={btn} disabled={step===0&&!startDate}
     onClick={()=>setStep(step+1)}>{step===2?"Skip for now / Continue":"Continue"}</button>:
    <button className="min-h-11 rounded bg-primary px-4 py-2 font-bold text-primary-foreground" type="submit">Start my books</button>}
  </div>
 </form>;
}
