"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RECOMMENDED_TELECOM_ALERT_RULES, type TelecomAlertRules } from "@/domains/messaging/telecom-alerts";

type AccountOption = { id:string; label:string };
type StatementItem = {
  id:string; accountLabel:string; externalId:string; revision:number;
  state:string; cents:number; currency:string; period:string; hash:string;
};
type Props = {
  accounts:AccountOption[]; statements:StatementItem[];
  canEdit:boolean; canSavePolicy:boolean; bootstrapAccountId:string | null;
  version:number; savedRules:TelecomAlertRules;
};
function dollars(cents:number):string { return (cents/100).toFixed(2); }
function toCents(value:string):number {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid dollar amount.");
  const [whole, fraction=""] = value.split(".");
  return Number(whole)*100 + Number(fraction.padEnd(2,"0"));
}
export function TelecomSettingsControls({accounts,statements,canEdit,canSavePolicy,bootstrapAccountId,version,savedRules}:Props) {
  const router=useRouter();
  const [rules,setRules]=useState<TelecomAlertRules>(savedRules);
  const [currentVersion,setVersion]=useState(version);
  const [message,setMessage]=useState("");
  const [working,setWorking]=useState(false);
  const [selectedAccount,setSelectedAccount]=useState(accounts[0]?.id??"");
  async function saveRules(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit || !canSavePolicy) return;
    setWorking(true); setMessage("");
    try {
      const response=await fetch("/api/desk/telecom",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({kind:"budget",expectedVersion:currentVersion,rules,accountId:bootstrapAccountId}),
      });
      const result=await response.json();
      if (!response.ok) throw new Error(result.error??"Couldn't save settings.");
      setVersion(result.version);
      setMessage("Saved as a preview. No alerts or sending are activated.");
      router.refresh();
    } catch(error) { setMessage(error instanceof Error?error.message:"Couldn't save settings."); }
    finally { setWorking(false); }
  }
  async function upload(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit) return;
    setWorking(true);setMessage("");
    try {
      const data=new FormData(e.currentTarget);
      const file=data.get("file");
      if (!(file instanceof File) || file.size>4*1024*1024) {
        throw new Error("Choose a PDF up to 4 MB.");
      }
      const response=await fetch("/api/desk/telecom",{method:"POST",body:data});
      const result=await response.json();
      if (!response.ok) throw new Error(result.error??"Couldn't store the PDF.");
      setMessage("Statement stored privately as a draft. Check it before verifying.");
      router.refresh();
    } catch(error) { setMessage(error instanceof Error?error.message:"Couldn't store statement."); }
    finally { setWorking(false); }
  }
  async function verify(row:StatementItem) {
    if (!canEdit || !window.confirm(
      "Verify that you personally checked this PDF, its dates and dollar total? This marks it verified, not paid.")) return;
    setWorking(true);setMessage("");
    try {
      const response=await fetch("/api/desk/telecom",{method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({kind:"verify",statementId:row.id,hash:row.hash}),
      });
      const data=await response.json();
      if (!response.ok) throw new Error(data.error??"Verification failed.");
      setMessage("Statement verified. No expense or payment was created.");
      router.refresh();
    } catch(error) {setMessage(error instanceof Error?error.message:"Verification failed.");}
    finally {setWorking(false);}
  }
  const changeMoney=(field:"monthlyBudgetCents"|"elevatedCents"|"criticalCents"|"minimumSpikeCents",
    value:string)=>{
    try {setRules(prev=>({...prev,[field]:toCents(value)}));}
    catch {setMessage("Enter dollars with up to two decimal places.");}
  };
  return <div className="space-y-8">
    <section aria-labelledby="telecom-budget-heading" className="rounded-card border border-line p-4">
      <h2 id="telecom-budget-heading" className="font-semibold">Spending warnings — preview only</h2>
      <p className="mt-2 text-sm text-ink-soft">
        Suggested thresholds start at $50, $75 and $100. They are not spending limits.
        Only the Owner may change these suggestions. No notification, automatic pause,
        or phone activity occurs until the separate launch approval.
      </p>
      {!canSavePolicy && <p className="mt-2 text-sm text-ink-soft">
        Save the base communications policy during provider setup before editing these settings.
      </p>}
      <form onSubmit={saveRules} className="mt-4 grid gap-3 sm:grid-cols-2">
        {([
          ["monthlyBudgetCents","First warning (dollars)"],
          ["elevatedCents","Higher warning (dollars)"],
          ["criticalCents","Critical warning (dollars)"],
          ["minimumSpikeCents","Minimum amount for spike checks (dollars)"],
        ] as const).map(([key,label])=><label key={key} className="text-sm">{label}
          <input className="mt-1 w-full rounded border border-line bg-surface p-2" type="number"
            min="0" step=".01" disabled={!canEdit||!canSavePolicy||working}
            value={dollars(rules[key])}
            onChange={e=>changeMoney(key,e.target.value)} />
        </label>)}
        <label className="text-sm">Increase for a spike (%)
          <input type="number" className="mt-1 w-full rounded border border-line bg-surface p-2"
            min="0" max="1000" step=".01" disabled={!canEdit||!canSavePolicy||working}
            value={rules.spikePercentBasisPoints/100}
            onChange={e=>setRules(v=>({...v,spikePercentBasisPoints:Math.round(Number(e.target.value)*100)}))} />
        </label>
        <label className="text-sm">Mark usage stale after (hours)
          <input type="number" className="mt-1 w-full rounded border border-line bg-surface p-2"
            min="1" max="744" disabled={!canEdit||!canSavePolicy||working}
            value={rules.staleAfterHours}
            onChange={e=>setRules(v=>({...v,staleAfterHours:Number(e.target.value)}))} />
        </label>
        <div className="col-span-full flex flex-wrap gap-2">
          <button disabled={!canEdit||!canSavePolicy||working} type="submit"
            className="rounded bg-ink px-4 py-2 text-surface disabled:opacity-50">Save warning suggestions</button>
          <button type="button" disabled={!canEdit||working}
            className="rounded border border-line px-4 py-2"
            onClick={()=>setRules({...RECOMMENDED_TELECOM_ALERT_RULES})}>Restore recommended</button>
        </div>
      </form>
    </section>
    <section aria-labelledby="telecom-invoices-heading" className="rounded-card border border-line p-4">
      <h2 id="telecom-invoices-heading" className="font-semibold">Private provider billing statements</h2>
      <p className="mt-2 text-sm text-ink-soft">Upload a PDF and enter its exact amount in dollars.
        The upload remains a draft until you personally verify the evidence.
        Verification does not mark it paid or post anything to accounting.</p>
      {canEdit && accounts.length>0 && <form onSubmit={upload} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Provider account
          <select name="accountId" value={selectedAccount} onChange={e=>setSelectedAccount(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-surface p-2">
            {accounts.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}
          </select></label>
        <label className="text-sm">Statement number
          <input required maxLength={100} name="externalId" className="mt-1 w-full rounded border border-line bg-surface p-2" />
        </label>
        {([["periodStart","Period starts"],["periodEnd","Period ends"],
          ["issueDate","Statement issued"]] as const).map(([name,label])=><label key={name} className="text-sm">{label}
          <input required type="date" name={name} className="mt-1 w-full rounded border border-line bg-surface p-2" />
        </label>)}
        <label className="text-sm">Currency
          <select name="currency" className="mt-1 w-full rounded border border-line bg-surface p-2">
            <option value="USD">USD</option>
          </select></label>
        <label className="text-sm">Statement total (dollars)
          <input required name="amountDollars" type="number" min="0" step=".01"
            className="mt-1 w-full rounded border border-line bg-surface p-2" />
        </label>
        <label className="text-sm col-span-full">Statement PDF (4 MB maximum)
          <input required name="file" type="file" accept=".pdf,application/pdf"
            className="mt-1 block w-full" />
        </label>
        <button disabled={working} type="submit"
          className="rounded bg-ink px-4 py-2 text-surface disabled:opacity-50">Store private draft</button>
      </form>}
      <ul className="mt-4 space-y-3">
        {statements.map(row=><li key={row.id} className="rounded border border-line p-3 text-sm">
          <strong>{row.externalId} (revision {row.revision})</strong> — {row.accountLabel};
          {" "}{row.period}; {row.currency} {dollars(row.cents)};
          {" "}{row.state}
          <div className="mt-2 flex flex-wrap gap-3">
            <a className="underline" href={"/api/desk/telecom?statement="+encodeURIComponent(row.id)}>
              Open private PDF
            </a>
            {canEdit && row.state==="DRAFT" && <button type="button"
              disabled={working} onClick={()=>verify(row)}
              className="underline disabled:opacity-50">Verify after reviewing PDF</button>}
          </div>
        </li>)}
        {statements.length===0 && <li className="text-sm text-ink-soft">No billing statements recorded.</li>}
      </ul>
    </section>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
