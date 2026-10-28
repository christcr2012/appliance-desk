import { requireRole } from "@/lib/session";
import { exportMonthReview } from "@/domains/books/management";
export async function GET(request:Request) {
  const session=await requireRole("OWNER","ADMIN","ACCOUNTANT");
  const month=new URL(request.url).searchParams.get("month")??"";
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return Response.json({error:"Choose a valid month."},{status:400});
  const {csv,fileName}=await exportMonthReview({id:session.user.id,role:session.user.role},month);
  return new Response(csv,{headers:{
    "Content-Type":"text/csv; charset=utf-8",
    "Content-Disposition":'attachment; filename="'+fileName+'"',
    "Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff",
  }});
}
