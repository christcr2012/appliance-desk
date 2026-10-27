import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { runBooksAutopilot } from "@/domains/books/autopilot";
import { runStripeBooksNightly } from "@/domains/books/stripe-balance";
import { prisma } from "@/lib/prisma";
import { applyStartingValues } from "@/domains/decisions/starting-values";
import { reportBackgroundError } from "@/lib/report-error";

export const maxDuration = 60;

/** Recording is always on after setup. Stripe importing remains an independent opt-in. */
export async function GET(request: Request): Promise<NextResponse> {
 const secret=process.env.CRON_SECRET;
 if(!secret)return NextResponse.json({error:"Not configured."},{status:500});
 if(!cronAuthorized(request.headers.get("authorization"),secret))
  return NextResponse.json({error:"Unauthorized."},{status:401});

 // DEC-2: researched starting values go in once, from the next Colorado business day, over untouched defaults only.
 // Runs here (no new cron entry) and before the Books check so it never waits on Books being set up.
 let startingValues:unknown=null;
 try{startingValues=await applyStartingValues();}
 catch(error){await reportBackgroundError(error,"books-nightly:starting-values");startingValues={outcome:"FAILED"};}

 const settings=await prisma.businessSettings.findUnique({
  where:{id:"singleton"},select:{booksStartDate:true},
 });
 if(!settings?.booksStartDate)
  return NextResponse.json({outcome:"PAUSED",reason:"Set up Books before automatic recording.",startingValues});

 const recording=await runAutomation({
  ruleKey:"books-nightly:record",budgetSeconds:50,
  work:async()=>({counts:await runBooksAutopilot()}),
 });
 // Do not let a failed recording run silently appear as a successful Stripe import.
 if(process.env.BOOKS_STRIPE_SYNC_ENABLED!=="true")
  return NextResponse.json({recording,stripe:{outcome:"PAUSED"},startingValues});

 const stripe=await runAutomation({
  // Keep the historic key: existing owner pauses and health history target this rule.
  ruleKey:"books-nightly",budgetSeconds:10,
  work:async()=>{
   const answer=await runStripeBooksNightly();
   if(answer.sync.state==="NOT_INITIALIZED")throw new Error("Owner must initialize books.");
   if(answer.clearing.state==="UNKNOWN")
    throw new Error("Stripe clearing could not be verified; review Books sources.");
   return {counts:{pages:answer.sync.pages,imported:answer.sync.transactions,
    posted:answer.posted,differences:answer.clearing.state==="DIFFERENCE"?1:0}};
  },
 });
 return NextResponse.json({recording,stripe,startingValues});
}
