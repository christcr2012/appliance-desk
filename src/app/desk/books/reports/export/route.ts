import { requireRole } from "@/lib/session";
import { financeReportCsv } from "@/domains/budget/reports";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const session=await requireRole("OWNER","ADMIN","ACCOUNTANT");
 const url=new URL(request.url);
 const param=(name:string)=>url.searchParams.get(name)??undefined;
 const compare=param("compare");
 try{
  const file=await financeReportCsv(session.user.id,{
   asOf:param("asOf"),months:param("months")?Number(param("months")):undefined,
   period:param("period"),from:param("from"),to:param("to"),
   compare:compare==="PREVIOUS_PERIOD"||compare==="SAME_PERIOD_LAST_YEAR"?compare:null
  });
  return new Response(file.content,{headers:{
   "Content-Type":"text/csv; charset=utf-8","Cache-Control":"private, no-store, max-age=0",
   "Content-Disposition":'attachment; filename="'+file.fileName+'"',
   "X-Content-Type-Options":"nosniff",
  }});
 }catch{
  return new Response("A finance report cannot be exported until its sources and date range are reviewed.",{
   status:422,headers:{"Cache-Control":"private, no-store","Content-Type":"text/plain; charset=utf-8"}});
 }
}
