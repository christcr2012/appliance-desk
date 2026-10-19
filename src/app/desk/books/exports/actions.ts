"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { runExport, type ExportInput } from "@/domains/books/exports";
import type { ExportMode, ExportTarget } from "@prisma/client";

export async function runBookExportAction(form:FormData) {
  const session=await requireRole("OWNER","ADMIN");
  const field=(name:string)=>String(form.get(name)??"").trim();
  const input:ExportInput={
    target:field("target") as ExportTarget,mode:field("mode") as ExportMode,
    from:field("from"),to:field("to"),onlyNotYetExported:form.get("onlyNew")==="on",
  };
  let url="/desk/books/exports";
  try {
    const result=await runExport(session.user.id,input);
    if("blocked" in result)url+="?notice="+encodeURIComponent(result.blocked.join(" | ").slice(0,600));
    else url+="?created="+encodeURIComponent(result.batchId);
  } catch(error) {
    url+="?notice="+encodeURIComponent((error instanceof Error?error.message:"Export failed").slice(0,600));
  }
  revalidatePath("/desk/books/exports");
  redirect(url);
}
