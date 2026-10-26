import { Prisma, type JournalSourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordSystemIssue } from "@/domains/system-issues";
import { postForSource } from "./post";

/** Best-effort short posting after the operational money transaction has committed. */
export async function postBookSourceAfterCommit(sourceType:JournalSourceType,sourceId:string):Promise<void>{
 try{
  await prisma.$transaction(tx=>postForSource(tx,sourceType,sourceId),
   {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }catch{
  // The money action succeeded already. Leave this source for tonight and a visible issue.
  try{await recordSystemIssue({kind:"BOOKS_POSTING_FAILURE",sourceType,sourceId});}
  catch{console.error("[books] Could not record a background books issue.");}
 }
}
