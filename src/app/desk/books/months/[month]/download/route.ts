import { requireRole } from "@/lib/session";
import { buildMonthPacket } from "@/domains/books/accountant-packet";
import { monthKey } from "@/domains/books/depreciation";

/** Authenticated, read-only CSV files. A download never emails or rewrites a ledger. */
export async function GET(request:Request,{params}:{params:Promise<{month:string}>}){
 const session=await requireRole("OWNER","ADMIN","ACCOUNTANT");
 const {month}=await params,kind=new URL(request.url).searchParams.get("file");
 if(kind!=="journal"&&kind!=="profit")
  return Response.json({error:"Choose journal or profit."},{status:400,
   headers:{"Cache-Control":"private, no-store"}});
 try{
  monthKey(month);
  const packet=await buildMonthPacket({
   id:session.user.id,role:session.user.role as "OWNER"|"ADMIN",
  },month);
  return new Response(kind==="journal"?packet.journalCsv:packet.profitCsv,{headers:{
   "Content-Type":"text/csv; charset=utf-8",
   "Content-Disposition":`attachment; filename="books-${kind}-${month}.csv"`,
   "Cache-Control":"private, no-store",
   "X-Content-Type-Options":"nosniff",
  }});
 }catch{
  return Response.json({error:"The accounting export needs review."},{status:422,
   headers:{"Cache-Control":"private, no-store"}});
 }
}
