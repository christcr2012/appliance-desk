import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { CustomerLanguage } from "./copy";
export function quoteNoteKey(text:string) {return createHash("sha256").update(text).digest("hex");}
export async function quoteNoteSources() {
 const rows=await prisma.estimate.findMany({where:{clientMessage:{not:null}},select:{clientMessage:true}});
 return new Map(rows.flatMap(row=>row.clientMessage?.trim()?[[quoteNoteKey(row.clientMessage),row.clientMessage] as const]:[]));
}
/** An owner-authored note is copy too; never silently mix an unreviewed note
 * into an otherwise Spanish quote/email. Stored source/evidence stays exact. */
export async function quoteLanguage(preference:CustomerLanguage,note:string|null) {
 const {displayCustomerLanguage}=await import("./review");
 const language=await displayCustomerLanguage(preference);
 if(language==="en" || !note?.trim())return {language,note};
 const {approvedSpanishSnapshot,translationFromSnapshot}=await import("./runtime");
 const {sources}=await approvedSpanishSnapshot();
 try{return {language,note:translationFromSnapshot(sources,"QUOTE",quoteNoteKey(note),note)};}
 catch{return {language:"en" as const,note};}
}
