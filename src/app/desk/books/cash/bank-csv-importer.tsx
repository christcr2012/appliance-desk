"use client";
import { useId, useState } from "react";
import { formatMoney } from "@/lib/money-ui";
import type { BankCsvMapping } from "@/domains/books/cash/csv";
type Account={id:string;name:string;lastFour:string|null};
type Preview={
 token:string;count:number;totalInflowsCents:number;totalOutflowsCents:number;
 firstTwenty:{rowNumber:number;dateKey:string;description:string;signedCents:number}[];
 overlap:{duplicates:number[];ambiguous:number[];conflicts:number[]};
 problems:string[];
};
export function BankCsvImporter({accounts,owner}:{accounts:Account[];owner:boolean}){
 const fileId=useId(),[file,setFile]=useState<File|null>(null);
 const [accountId,setAccountId]=useState(accounts[0]?.id??"");
 const [dateColumn,setDateColumn]=useState("Date"),[descriptionColumn,setDescriptionColumn]=useState("Description");
 const [amountColumn,setAmountColumn]=useState("Amount"),[debitColumn,setDebitColumn]=useState("");
 const [creditColumn,setCreditColumn]=useState(""),[externalIdColumn,setExternalIdColumn]=useState("");
 const [dateFormat,setDateFormat]=useState<BankCsvMapping["dateFormat"]>("MM/DD/YYYY");
 const [bankCreditIsPositive,setBankCreditIsPositive]=useState(true);
 const [state,setState]=useState<Preview|null>(null),[pending,setPending]=useState(false);
 const [message,setMessage]=useState(""),[supersedeReason,setSupersedeReason]=useState("");
 const [overlaps,setOverlaps]=useState<Record<number,"KEEP_EXISTING"|"ADDITIONAL">>({});
 const [commandKey,setCommandKey]=useState("");
 const base="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
 const action="rounded border border-border bg-card px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";
 const reset=()=>{setState(null);setMessage("");setOverlaps({});setCommandKey("");};
 function mapping():BankCsvMapping{
  return {schemaVersion:1,dateColumn,descriptionColumn,
   ...(amountColumn?{amountColumn}:{debitColumn,creditColumn}),
   ...(externalIdColumn?{externalIdColumn}:{}),dateFormat,bankCreditIsPositive};
 }
 const dollars=formatMoney;
 async function request(preview:boolean){
  if(!file||!accountId)return;
  setPending(true);setMessage("");
  try{
   const body=new FormData();body.set("file",file);body.set("cashAccountId",accountId);
   body.set("mapping",JSON.stringify(mapping()));
   if(!preview&&state){body.set("token",state.token);body.set("commandKey",commandKey);
    body.set("choices",JSON.stringify({overlaps,supersedeReason}));}
   const response=await fetch(preview?"/api/desk/books/cash/import/preview":
    "/api/desk/books/cash/import/commit",{method:"POST",body,cache:"no-store"});
   const result=await response.json() as Preview&{error?:string;importId?:string};
   if(!response.ok){setMessage(result.error??"Bank import was refused.");return;}
   if(preview){setState(result);setCommandKey(crypto.randomUUID());}
   else{setMessage("Imported and archived bank evidence "+(result.importId??"")+". Reload to view the new immutable record.");setState(null);}
  }catch(e){setMessage(e instanceof Error?e.message:"Could not process bank CSV.");}
  finally{setPending(false);}
 }
 return <section className="rounded-lg border border-border p-4 space-y-3">
  <h2 className="text-lg font-semibold">Import a settled bank CSV</h2>
  <p className="text-sm text-muted-foreground">The bank CSV is parsed privately on the server, never sent to an accounting provider. Preview uses real dates and whole cents; imports do not move money, add to available cash, or finish reconciliation.</p>
  {!accounts.length?<p>Register an actual business bank source before previewing transactions.</p>:<div className="grid gap-3 sm:grid-cols-2">
   <label>Registered bank<select className={base} value={accountId} onChange={e=>{setAccountId(e.target.value);reset();}}>
    {accounts.map(x=><option key={x.id} value={x.id}>{x.name}{x.lastFour?" ····"+x.lastFour:""}</option>)}
   </select></label>
   <label htmlFor={fileId}>Settled CSV file (5 MiB max)
    <input id={fileId} type="file" accept=".csv,text/csv" className={base}
     onChange={e=>{setFile(e.target.files?.[0]??null);reset();}}/>
   </label>
   <label>Date column<input className={base} value={dateColumn} onChange={e=>{setDateColumn(e.target.value);reset();}}/></label>
   <label>Description column<input className={base} value={descriptionColumn} onChange={e=>{setDescriptionColumn(e.target.value);reset();}}/></label>
   <label>Signed amount column (or leave blank for separate debit/credit)<input className={base} value={amountColumn} onChange={e=>{setAmountColumn(e.target.value);reset();}}/></label>
   {!amountColumn&&<><label>Debit column<input className={base} value={debitColumn} onChange={e=>{setDebitColumn(e.target.value);reset();}}/></label>
    <label>Credit column<input className={base} value={creditColumn} onChange={e=>{setCreditColumn(e.target.value);reset();}}/></label></>}
   <label>External transaction ID column (optional)<input className={base} value={externalIdColumn} onChange={e=>{setExternalIdColumn(e.target.value);reset();}}/></label>
   <label>Date format<select className={base} value={dateFormat} onChange={e=>{setDateFormat(e.target.value as BankCsvMapping["dateFormat"]);reset();}}>
    <option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option>
   </select></label>
   <label className="flex items-center gap-2 pt-4"><input type="checkbox" checked={bankCreditIsPositive} onChange={e=>{setBankCreditIsPositive(e.target.checked);reset();}}/>Positive/credit amount means bank inflow</label>
   <div className="sm:col-span-2"><button disabled={pending||!file} type="button" onClick={()=>void request(true)} className={action}>{pending?"Checking…":"Preview before importing"}</button></div>
  </div>}
  {state&&<div className="space-y-3 border-t border-border pt-3">
   <p role="status">{state.count} settled rows · Inflows {dollars(state.totalInflowsCents)} · Outflows {dollars(state.totalOutflowsCents)}</p>
   <p>Existing duplicate IDs: {state.overlap.duplicates.length}; ambiguous same-day fingerprints: {state.overlap.ambiguous.length}; conflicting IDs: {state.overlap.conflicts.length}.</p>
   {state.problems.map((p,i)=><p key={i} role="alert" className="text-destructive">{p}</p>)}
   {state.firstTwenty.length>0&&<div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left">First 20 redacted observations (preview only)</caption>
    <thead><tr className="border-b border-border"><th scope="col">Row</th><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Movement</th></tr></thead>
    <tbody>{state.firstTwenty.map(r=><tr key={r.rowNumber} className="border-b border-border"><td>{r.rowNumber}</td><td>{r.dateKey}</td><td className="break-words">{r.description}</td><td className="tabular-nums whitespace-nowrap">{dollars(r.signedCents)}</td></tr>)}</tbody>
   </table></div>}
   {state.overlap.ambiguous.map(n=><label key={n} className="block">Overlapping row {n} (OWNER decision required)
    <select className={base} value={overlaps[n]??""} onChange={e=>setOverlaps({...overlaps,[n]:e.target.value as "KEEP_EXISTING"|"ADDITIONAL"})} disabled={!owner}>
     <option value="">Choose after comparing original evidence</option>
     <option value="KEEP_EXISTING">Keep existing row; do not import this row</option>
     <option value="ADDITIONAL">This is a separate legitimate transaction</option>
    </select>
   </label>)}
   {owner&&<label>Correction reason (required if replacing a previously imported mapping)<input className={base} value={supersedeReason} maxLength={250} onChange={e=>setSupersedeReason(e.target.value)}/></label>}
   <button type="button" className={action} disabled={pending||state.problems.length>0||
    (state.overlap.ambiguous.length>0&&(!owner||state.overlap.ambiguous.some(n=>!overlaps[n])))}
    onClick={()=>void request(false)}>{pending?"Verifying source…":"Confirm and archive import"}</button>
  </div>}
  {message&&<p role="status" className="rounded border border-border p-3 break-words">{message}</p>}
 </section>;
}
