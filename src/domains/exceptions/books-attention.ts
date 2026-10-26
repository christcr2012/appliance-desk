import { prisma } from "@/lib/prisma";
import type { ExceptionItem } from "./rules";

/** Background-book exceptions are created from durable source evidence, never client-only flags. */
export async function listBooksAttention(now = new Date()):Promise<ExceptionItem[]> {
 const settings=await prisma.businessSettings.findUnique({where:{id:"singleton"},select:{
  booksStartDate:true,booksConsecutiveFailedNights:true,
 }});
 if(!settings?.booksStartDate)return [];
 const items:ExceptionItem[]=[];
 if(settings.booksConsecutiveFailedNights>=1)items.push({
  category:"BOOKS_NOT_UP_TO_DATE",
  severity:settings.booksConsecutiveFailedNights>=2?"high":"medium",
  title:"Your books didn't update last night",
  detail:"We'll try again tonight. Open Books to see what stopped it.",
  href:"/desk/books",since:now,
 });
 const problems=await prisma.booksProblem.findMany({where:{resolvedAt:null},
  orderBy:[{firstSeenAt:"asc"},{id:"asc"}],take:50,
 });
 const applianceIds=problems.filter(p=>p.subjectType==="APPLIANCE").map(p=>p.subjectId);
 const appliances=applianceIds.length?await prisma.appliance.findMany({
  where:{id:{in:applianceIds}},select:{id:true,assetNumber:true},
 }):[];
 const names=new Map(appliances.map(a=>[a.id,a.assetNumber]));
 for(const problem of problems){
  const appliance=problem.subjectType==="APPLIANCE";
  const label=names.get(problem.subjectId)??"An appliance";
  items.push({
   category:"BOOKS_NEEDS_FIX",severity:"medium",
   title:appliance?`${label} isn't in your books yet`:"A financial record couldn't be recorded",
   detail:problem.message,
   href:appliance?`/desk/inventory/${problem.subjectId}`:"/desk/books",
   since:problem.firstSeenAt,
  });
 }
 return items;
}
