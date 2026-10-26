"use client";
import { useState } from "react";
import { Sheet } from "@/components/kit/sheet";
import { correctOpeningBalancesAction } from "./actions";

const field="block min-h-11 w-full rounded border border-border bg-background px-3 py-2";
const dollars=(cents:number)=>(cents/100).toFixed(2);
export function OpeningCorrectionSheet({opening}:{opening:{
 bankCents:number;stripeCents:number;cardCents:number;
}}){
 const [open,setOpen]=useState(false);
 return <>
  <button type="button" onClick={()=>setOpen(true)}
   className="min-h-11 rounded border border-border px-3 py-2 font-semibold">
   Correct my starting balances
  </button>
  <Sheet open={open} onOpenChange={setOpen} title="Correct starting balances">
   <form action={correctOpeningBalancesAction} className="space-y-4">
    <p className="text-sm text-muted-foreground">Your original entry stays on record. Any change creates a second balanced entry. Nothing sends or moves money.</p>
    <label className="block">Business checking that day ($)
     <input className={field} required inputMode="decimal" name="bank" defaultValue={dollars(opening.bankCents)}/>
    </label>
    <label className="block">Stripe balance that day ($)
     <input className={field} required inputMode="decimal" name="stripe" defaultValue={dollars(opening.stripeCents)}/>
    </label>
    <label className="block">Credit card owed that day ($)
     <input className={field} required inputMode="decimal" name="card" defaultValue={dollars(opening.cardCents)}/>
    </label>
    <label className="block">Why are you correcting these balances?
     <textarea className={field} name="reason" maxLength={300} required rows={3}/>
    </label>
    <button className="w-full min-h-11 rounded bg-primary px-4 py-2 font-semibold text-primary-foreground" type="submit">
     Save correction
    </button>
   </form>
  </Sheet>
 </>;
}
