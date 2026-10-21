import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { formatMoney } from "@/lib/money-ui";
import { getBudgetPlanning } from "./planning";

/**
 * Server-only role-shaped view. Staff receive *labels only*; never derive
 * sensitive numbers and hide them in the browser.
 */
export async function getBudgetContext(userId:string){
 const role=await prisma.$transaction(tx=>assertActiveTeamActor(tx,userId,["OWNER","ADMIN","STAFF"]));
 if(role.role==="STAFF"){
  const envelopes=await prisma.budgetEnvelope.findMany({where:{active:true},
   select:{name:true},orderBy:[{sortOrder:"asc"},{id:"asc"}],take:100});
  return {role:"STAFF" as const,envelopes:envelopes.map(e=>({name:e.name}))};
 }
 const info=await getBudgetPlanning(userId);
 return {role:"MANAGER" as const,sourceStatus:info.sourceStatus,
  reviewReason:info.sourceReasons[0]??null,
  envelopes:info.envelopes.filter(e=>e.active).map(e=>({
   name:e.name,id:e.id,balanceCents:e.balanceCents,needCents:e.needCents,
   unpaidUpcomingCents:e.unpaidUpcomingCents})),readyCents:info.readyCents};
}

export async function BudgetContextCard({userId,heading="Budget context"}:{
 userId:string;heading?:string}){
 let context:Awaited<ReturnType<typeof getBudgetContext>>|null=null;
 try{context=await getBudgetContext(userId);}
 catch{return <aside className="rounded-lg border border-border p-4">
  <h2 className="font-semibold">{heading}</h2>
  <p>Budget evidence is unavailable. This does not block recording legitimate expenses or stock receipts.</p>
 </aside>;}
 return <aside className="rounded-lg border border-border p-4 space-y-2">
  <h2 className="text-lg font-semibold">{heading}</h2>
  <p className="text-sm">Budget envelopes are virtual planning labels, not a bank transfer, payment, tax or authority to post an expense.</p>
  {context.role==="STAFF"?<p>Available planning labels: {context.envelopes.length?
   context.envelopes.map(x=>x.name).join(", "):"none set up"}. Funding and protected information is owner-only.</p>:
   <>
    <p role="status">Cash review: {context.sourceStatus}. Ready to assign: {context.readyCents===null?
     "Unknown":formatMoney(context.readyCents)}.</p>
    {context.reviewReason&&<p className="text-sm">Source attention: {context.reviewReason}</p>}
    <ul className="grid gap-1 sm:grid-cols-2 text-sm">{context.envelopes.slice(0,12).map(e=>
     <li key={e.id}>{e.name}: saved {formatMoney(e.balanceCents)}; needed {formatMoney(e.needCents)}; unpaid soon {formatMoney(e.unpaidUpcomingCents)}</li>)}</ul>
    <Link href="/desk/books/budget?tab=plan" className="underline">Plan and preview funding (owner confirmation required)</Link>
   </>}
 </aside>;
}
