import { requireRole } from "@/lib/session";
import { yearEndPackage,YEAR_FILES } from "@/domains/books/closing";

export async function GET(request:Request){
 const session=await requireRole("OWNER","ADMIN");
 const uri=new URL(request.url),file=uri.searchParams.get("file")??"",
  year=Number(uri.searchParams.get("year")??"");
 if(!YEAR_FILES.includes(file as (typeof YEAR_FILES)[number])||!Number.isSafeInteger(year))
  return Response.json({error:"Invalid accounting export request."},{status:400,
   headers:{"Cache-Control":"private, no-store"}});
 try {
  const result=await yearEndPackage(session.user.id,year,file as (typeof YEAR_FILES)[number]);
  return new Response(result.content,{headers:{
   "Content-Type":"text/csv; charset=utf-8",
   "Content-Disposition":`attachment; filename="${result.filename}"`,
   "Cache-Control":"private, no-store",
   "X-Content-Type-Options":"nosniff",
  }});
 }catch{
  return Response.json({error:"Year-end data needs configuration or review."},{status:422,
   headers:{"Cache-Control":"private, no-store"}});
 }
}
