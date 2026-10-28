import { requireRole } from "@/lib/session";
import { readBookExport } from "@/domains/books/exports";

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const session=await requireRole("OWNER","ADMIN","ACCOUNTANT");
 try{
  const {id}=await params;
  const exportBatch=await readBookExport(session.user.id,id);
  const filename=exportBatch.fileName.replace(/[^a-z0-9_.-]/gi,"_");
  return new Response(exportBatch.content,{headers:{
    "Content-Type":"text/csv; charset=utf-8",
    "Content-Disposition":`attachment; filename="${filename}"`,
    "Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff",
  }});
 }catch{
  return Response.json({error:"Export not found or unreadable."},{status:404,
    headers:{"Cache-Control":"private, no-store"}});
 }
}
