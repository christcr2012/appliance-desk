import type { ExportMode, ExportTarget } from "@prisma/client";
import { businessDateKey } from "@/lib/business-date";
import { formatCentsAsPlainDecimal } from "@/domains/pricing/money";
import { allocateAcrossLines } from "@/domains/tax/allocate";
import { toCsv } from "@/lib/csv";

export class ExportIntegrityError extends Error {}
export type ExportLine = {
  ledgerAccountId: string; accountName: string; externalName: string;
  externalTaxRate: string | null; isPaymentSource: boolean; systemRole: string | null;
  debitCents: number; creditCents: number;
};
export type ExportEntry = {
  id: string; entryNumber: number; entryDate: Date; memo: string;
  sourceType: string; eventKind: string; lines: ExportLine[];
};
type Flat = {
  date: string; journalNo: string; account: string; taxRate: string;
  debit: number; credit: number; memo: string; source: string;
};
function amount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new ExportIntegrityError("Invalid journal cents.");
  return value;
}
function checked(entry: ExportEntry): void {
  if (!Number.isSafeInteger(entry.entryNumber) || entry.entryNumber < 1 || !entry.lines.length)
    throw new ExportIntegrityError("Journal entry identity or lines missing.");
  let debit = 0, credit = 0;
  for (const line of entry.lines) {
    const left=amount(line.debitCents), right=amount(line.creditCents);
    if (left && right)
      throw new ExportIntegrityError("Journal line has both debit and credit.");
    debit += line.debitCents; credit += line.creditCents;
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit))
      throw new ExportIntegrityError("Journal total overflows integer cents.");
    if (!line.externalName.trim()) throw new ExportIntegrityError("Missing mapped account.");
  }
  if (debit !== credit || debit === 0) throw new ExportIntegrityError("Unbalanced or empty journal.");
}
const iso = (entry: ExportEntry) => businessDateKey(entry.entryDate);
const us = (value: string) => value.slice(5,7)+"/"+value.slice(8,10)+"/"+value.slice(0,4);
// Official Xero manual-journal imports accept yyyy/mm/dd or dd/mm/yyyy, even for US organisations.
const xero = (value: string) => value.replaceAll("-","/");
/** Only a code-created checked numeric decimal may bypass text/formula sanitization.
 * toCsv still handles every vendor name, memo, account and description as unsafe text. */
function decimal(cents: number): { toString(): string } {
  if (!Number.isSafeInteger(cents)) throw new ExportIntegrityError("Invalid decimal amount.");
  return { toString: () => formatCentsAsPlainDecimal(cents) };
}
function detail(entries: ExportEntry[]): Flat[] {
  return entries.flatMap(e=>e.lines.filter(l=>l.debitCents||l.creditCents).map(l=>({
    date:iso(e), journalNo:"AD-"+e.entryNumber, account:l.externalName,
    taxRate:l.externalTaxRate?.trim() || "Tax Exempt",
    debit:l.debitCents, credit:l.creditCents, memo:e.memo,
    source:e.sourceType+":"+e.eventKind,
  })));
}
function daily(entries: ExportEntry[]): Flat[] {
  const groups = new Map<string,{day:string;account:string;taxRate:string;net:number}>();
  for (const e of entries)for (const l of e.lines) {
    const day=iso(e), key=day+"\x00"+l.ledgerAccountId;
    const prev=groups.get(key);
    const net=(prev?.net??0)+l.debitCents-l.creditCents;
    if (!Number.isSafeInteger(net)) throw new ExportIntegrityError("Daily summary exceeds safe cents.");
    groups.set(key,{day,account:l.externalName,taxRate:l.externalTaxRate?.trim() || "Tax Exempt",net});
  }
  const rows=[...groups.values()].filter(g=>g.net!==0)
    .sort((a,b)=>a.day.localeCompare(b.day)||a.account.localeCompare(b.account));
  const totals=new Map<string,number>();
  for(const r of rows)totals.set(r.day,(totals.get(r.day)??0)+r.net);
  if([...totals.values()].some(n=>n!==0)) throw new ExportIntegrityError("Daily summary did not balance.");
  return rows.map(g=>({date:g.day,journalNo:"AD-"+g.day.replaceAll("-",""),account:g.account,
    taxRate:g.taxRate,debit:Math.max(g.net,0),credit:Math.max(-g.net,0),
    memo:"Appliance Desk daily summary",source:"DAILY_SUMMARY"}));
}
function formatCash(entries: ExportEntry[], mode: ExportMode): string {
  const rows: {date:string;account:string;description:string;amount:number;category:string}[]=[];
  for(const e of entries) {
    const cash=e.lines.filter(l=>l.isPaymentSource||l.systemRole==="STRIPE_CLEARING");
    for(const side of cash){
      const signed=side.debitCents-side.creditCents;
      if(!signed) continue;
      const opposite=e.lines.filter(l=>l!==side && (signed>0?l.creditCents>0:l.debitCents>0));
      if(!opposite.length)throw new ExportIntegrityError("Cash movement has no matching opposite account.");
      const weights=opposite.map(l=>signed>0?l.creditCents:l.debitCents);
      const portions=allocateAcrossLines(Math.abs(signed),weights);
      for(let i=0;i<opposite.length;i++)if(portions[i]!==0)rows.push({
        date:iso(e),account:side.externalName,description:e.memo,
        amount:Math.sign(signed)*portions[i]!,category:opposite[i]!.externalName,
      });
    }
  }
  const summarized=mode==="DAILY_SUMMARY"?(()=>{
    const grouped=new Map<string,(typeof rows)[number]>();
    for(const row of rows){
      const key=[row.date,row.account,row.category].join("\x00");
      const prior=grouped.get(key);
      const next=(prior?.amount??0)+row.amount;
      if(!Number.isSafeInteger(next))throw new ExportIntegrityError("Cash summary exceeds safe cents.");
      grouped.set(key,{...row,description:"Appliance Desk daily summary",amount:next});
    }
    return [...grouped.values()].filter(r=>r.amount!==0);
  })():rows;
  const ordered=[...summarized].sort((a,b)=>a.date.localeCompare(b.date)||a.account.localeCompare(b.account)||a.category.localeCompare(b.category));
  return toCsv(
    [{key:"date",header:"Date"},{key:"account",header:"Account"},{key:"description",header:"Description"},
      {key:"amount",header:"Amount"},{key:"category",header:"Category"}],
    ordered.map(x=>({date:x.date,account:x.account,description:x.description,amount:decimal(x.amount),category:x.category})),
  );
}
export function formatBookExport(target: ExportTarget, mode: ExportMode, entries: ExportEntry[]): string {
  if(!["DETAIL","DAILY_SUMMARY"].includes(mode))throw new ExportIntegrityError("Unknown export mode.");
  if(!["QBO_JOURNAL_CSV","XERO_JOURNAL_CSV","GENERIC_JOURNAL_CSV","CASH_MOVEMENTS_CSV"].includes(target))
    throw new ExportIntegrityError("Unknown export target.");
  for(const e of entries)checked(e);
  if(target==="CASH_MOVEMENTS_CSV")return formatCash(entries,mode);
  const rows=mode==="DAILY_SUMMARY"?daily(entries):detail(entries);
  if(target==="QBO_JOURNAL_CSV")return toCsv(
    [{key:"journalNo",header:"Journal No"},{key:"date",header:"Journal Date"},{key:"account",header:"Account"},
      {key:"debit",header:"Debits"},{key:"credit",header:"Credits"},{key:"memo",header:"Description"}],
    rows.map(r=>({journalNo:r.journalNo,date:us(r.date),account:r.account,
      debit:r.debit?decimal(r.debit):"",credit:r.credit?decimal(r.credit):"",memo:r.memo})),
  );
  if(target==="XERO_JOURNAL_CSV")return toCsv(
    [{key:"narration",header:"*Narration"},{key:"date",header:"*Date"},{key:"description",header:"Description"},
      {key:"account",header:"*AccountCode"},{key:"tax",header:"*TaxRate"},{key:"amount",header:"*Amount"}],
    rows.map(r=>({narration:r.journalNo+" / "+r.memo,date:xero(r.date),description:r.source,account:r.account,
      tax:r.taxRate,amount:decimal(r.debit-r.credit)})),
  );
  return toCsv(
    [{key:"entry",header:"Entry"},{key:"date",header:"Date"},{key:"account",header:"Account"},
      {key:"debit",header:"Debit"},{key:"credit",header:"Credit"},{key:"memo",header:"Memo"},{key:"source",header:"Source"}],
    rows.map(r=>({entry:r.journalNo,date:r.date,account:r.account,
      debit:r.debit?decimal(r.debit):"",credit:r.credit?decimal(r.credit):"",memo:r.memo,source:r.source})),
  );
}
