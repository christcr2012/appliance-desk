import { createHash } from "node:crypto";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { CashEvidenceError } from "./accounts";

export type BankCsvMapping={
 schemaVersion:1;dateColumn:string;descriptionColumn:string;
 amountColumn?:string;debitColumn?:string;creditColumn?:string;externalIdColumn?:string;
 dateFormat:"MM/DD/YYYY"|"YYYY-MM-DD";bankCreditIsPositive:boolean;
};
export type ParsedObservation={
 rowNumber:number;postedOn:Date;dateKey:string;signedCents:number;description:string;
 externalId:string|null;fingerprint:string;occurrenceIndex:number;
};
export type ParsedBankCsv={sha256:string;mappingHash:string;rows:ParsedObservation[];
 totalInflowsCents:number;totalOutflowsCents:number;firstTwenty:ParsedObservation[]};
const MAX_BYTES=5*1024*1024, MAX_ROWS=10000;
export const canonicalMapping=(m:BankCsvMapping)=>{
 if(m.schemaVersion!==1||!["MM/DD/YYYY","YYYY-MM-DD"].includes(m.dateFormat)||
   typeof m.bankCreditIsPositive!=="boolean")throw new CashEvidenceError("Unsupported CSV mapping.");
 const cols=[m.dateColumn,m.descriptionColumn,m.amountColumn,m.debitColumn,m.creditColumn,m.externalIdColumn]
   .filter((x):x is string=>x!==undefined);
 if(cols.some(c=>!c.trim()||c.length>120)||new Set(cols).size!==cols.length)
   throw new CashEvidenceError("CSV mapping column names must be distinct.");
 if(!!m.amountColumn===(!!m.debitColumn&&!!m.creditColumn))
   throw new CashEvidenceError("Choose signed Amount or both Debit and Credit, not both.");
 if(!m.amountColumn && !(m.debitColumn&&m.creditColumn))
   throw new CashEvidenceError("Both Debit and Credit are required when there is no Amount.");
 return {schemaVersion:1 as const,dateColumn:m.dateColumn,descriptionColumn:m.descriptionColumn,
  amountColumn:m.amountColumn??null,debitColumn:m.debitColumn??null,creditColumn:m.creditColumn??null,
  externalIdColumn:m.externalIdColumn??null,dateFormat:m.dateFormat,bankCreditIsPositive:m.bankCreditIsPositive};
};
/** Strict RFC-4180 quotes, CRLF and escaped quotes, with explicit rejection of malformed fields. */
export function decodeCsv(text:string):string[][] {
 const rows:string[][]=[];let row:string[]=[],field="",quoted=false,afterQuote=false,started=false;
 const pushField=()=>{row.push(field);field="";afterQuote=false;started=false;};
 const pushRow=()=>{pushField();rows.push(row);row=[];if(rows.length>MAX_ROWS+1)throw new CashEvidenceError("Bank CSV exceeds 10,000 observations.");};
 for(let i=0;i<text.length;i++){
  const c=text[i]!;
  if(c==="\u0000")throw new CashEvidenceError("Bank CSV contains invalid control data.");
  if(quoted){
   if(c==='"'){
    if(text[i+1]==='"'){field+='"';i++;}
    else {quoted=false;afterQuote=true;}
   }else field+=c;
  }else if(afterQuote){
   if(c===",")pushField();
   else if(c==="\n"){pushRow();}
   else if(c==="\r"&&text[i+1]==="\n"){i++;pushRow();}
   else throw new CashEvidenceError("Unquoted characters after CSV closing quote.");
  }else if(c==='"'){
   if(field.length||started)throw new CashEvidenceError("Unexpected quote inside unquoted CSV field.");
   quoted=true;started=true;
  }else if(c===",")pushField();
  else if(c==="\n")pushRow();
  else if(c==="\r"&&text[i+1]==="\n"){i++;pushRow();}
  else {field+=c;started=true;}
 }
 if(quoted)throw new CashEvidenceError("Unterminated quoted bank CSV field.");
 if(row.length||field.length||afterQuote||started)pushRow();
 if(rows.length<2)throw new CashEvidenceError("Bank CSV must contain a header and at least one settled row.");
 return rows;
}
const cents=(source:string,allowNegative:boolean)=>{
 const raw=source.trim();
 if(!raw)return 0;
 if(!new RegExp(allowNegative?"^-?(0|[1-9][0-9]{0,7})(?:\\.[0-9]{1,2})?$":"^(0|[1-9][0-9]{0,7})(?:\\.[0-9]{1,2})?$").test(raw))
  throw new CashEvidenceError("Bank amounts must be ordinary decimal dollars with at most two places.");
 const negative=raw.startsWith("-"),body=negative?raw.slice(1):raw;
 const [major,minor=""]=body.split(".");
 const value=Number(major)*100+Number(minor.padEnd(2,"0"));
 if(!Number.isSafeInteger(value)||value>1_000_000_000)
  throw new CashEvidenceError("Bank amount is outside safe cents.");
 return negative?-value:value;
};
export const redactBankDescription=(s:string)=>{
 const text=s.replace(/\b\d{3}-\d{2}-\d{4}\b/g,"[REDACTED]")
  .replace(/\b(?:\d[ -]?){12,19}\d\b/g,"[REDACTED]")
  .replace(/\b\d{9,17}\b/g,"[REDACTED]")
  .replace(/[\x00-\x1f\x7f]/g," ").replace(/\s+/g," ").trim();
 return text.slice(0,240);
};
function bankDate(text:string,format:BankCsvMapping["dateFormat"]){
 let key=text.trim();
 if(format==="MM/DD/YYYY"){
  const match=/^(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/(\d{4})$/.exec(key);
  if(!match)throw new CashEvidenceError("Bank date must use explicit MM/DD/YYYY.");
  key=match[3]+"-"+match[1]+"-"+match[2];
 }
 const date=businessDateFromKey(key);
 if(!date||businessDateKey(date)!==key||date.getTime()>Date.now())
  throw new CashEvidenceError("Bank date is nonexistent or in the future.");
 return {key,date};
}
const sha=(x:string|Uint8Array)=>createHash("sha256").update(x).digest("hex");
export function parseBankCsv(bytes:Uint8Array,mapping:BankCsvMapping):ParsedBankCsv {
 if(bytes.length>MAX_BYTES||bytes.length<5)throw new CashEvidenceError("Bank CSV must be under 5 MiB and nonempty.");
 const m=canonicalMapping(mapping);
 let text:string;
 try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
 catch{throw new CashEvidenceError("Bank CSV must be valid UTF-8.");}
 const data=decodeCsv(text.replace(/^\uFEFF/,""));
 const headings=data[0]!,header=new Map(headings.map((h,i)=>[h.trim(),i]));
 if(headings.some(h=>!h.trim())||headings.length!==header.size)
  throw new CashEvidenceError("CSV header columns must be unique and named.");
 const required=[m.dateColumn,m.descriptionColumn,m.amountColumn,m.debitColumn,m.creditColumn,m.externalIdColumn]
  .filter((s):s is string=>!!s);
 if(required.some(x=>!header.has(x)))throw new CashEvidenceError("Selected CSV column is missing.");
 const get=(cells:string[],key:string|null)=>key===null?"":cells[header.get(key)!]??"";
 const seen=new Map<string,number>();let inflows=0,outflows=0;
 const rows=data.slice(1).map((cells,index)=>{
  if(cells.length!==headings.length)throw new CashEvidenceError("CSV row "+(index+2)+" has a different number of columns.");
  const {key,date}=bankDate(get(cells,m.dateColumn),m.dateFormat);
  const description=redactBankDescription(get(cells,m.descriptionColumn));
  if(!description)throw new CashEvidenceError("CSV row "+(index+2)+" needs a description.");
  let amount=0;
  if(m.amountColumn)amount=cents(get(cells,m.amountColumn),true);
  else {
   const deb=cents(get(cells,m.debitColumn),false),cred=cents(get(cells,m.creditColumn),false);
   if(deb&&cred)throw new CashEvidenceError("A bank row cannot have both debit and credit.");
   amount=cred-deb;
  }
  if(!m.bankCreditIsPositive)amount=-amount;
  if(!amount)throw new CashEvidenceError("A bank observation must move nonzero cents.");
  const rawExternalId=get(cells,m.externalIdColumn).trim();
  const externalId=rawExternalId||null;
  if(externalId&&(!/^[A-Za-z0-9_.-]{1,150}$/.test(externalId)))
   throw new CashEvidenceError("Bank transaction IDs contain invalid characters.");
  const fingerprint=sha([key,amount,description.toLowerCase()].join("\u0000"));
  const occurrenceIndex=(seen.get(fingerprint)??0)+1;seen.set(fingerprint,occurrenceIndex);
  if(amount>0)inflows+=amount;else outflows+=-amount;
  if(!Number.isSafeInteger(inflows)||!Number.isSafeInteger(outflows))
   throw new CashEvidenceError("CSV totals exceed safe whole cents.");
  return {rowNumber:index+1,postedOn:date,dateKey:key,signedCents:amount,
   description,externalId,fingerprint,occurrenceIndex};
 });
 if(rows.length>MAX_ROWS)throw new CashEvidenceError("Bank CSV exceeds 10,000 settled rows.");
 return {sha256:sha(bytes),mappingHash:sha(JSON.stringify(m)),rows,totalInflowsCents:inflows,
  totalOutflowsCents:outflows,firstTwenty:rows.slice(0,20)};
}
