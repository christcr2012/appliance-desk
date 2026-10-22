"use client";
import { useState } from "react";
import { formatMoney } from "@/lib/money-ui";

export function ExpenseBudgetFields({manager,choices}:{
 manager:boolean;choices:Array<{id:string;name:string;balanceCents?:number}>}){
 const [text,setText]=useState(""),[selected,setSelected]=useState("");
 const chosen=choices.find(e=>e.id===selected);
 const amount=/^[0-9]{1,8}(?:\.[0-9]{1,2})?$/.test(text)?Math.round(Number(text)*100):null;
 const after=chosen?.balanceCents===undefined||amount===null?null:chosen.balanceCents-amount;
 const field="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
 return <>
  <label>Total paid ($)<input className={field} name="amount" type="text"
   inputMode="decimal" placeholder="0.00" value={text}
   onChange={e=>setText(e.target.value)} required/></label>
  <label>Requested discretionary budget label (optional)<select name="budgetEnvelopeId"
   value={selected} onChange={e=>setSelected(e.target.value)} className={field}>
   <option value="">Not selected — owner can review later</option>
   {choices.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
  </select></label>
  <p role="status" className="sm:col-span-2 text-sm">
   {manager&&selected&&after!==null?
    "Illustrative remaining "+formatMoney(after)+" if this amount is later classified to "+chosen?.name+"; this is NOT spendable bank cash and cannot authorize posting.":
    selected?"Selected label will be sent with the expense for owner review. No private budget balances are shown.":
    "An expense can be recorded without assigning a budget envelope. The owner will review actual posted bank spending."}
  </p>
 </>;
}
