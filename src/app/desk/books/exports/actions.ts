"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { runExport, type ExportInput } from "@/domains/books/exports";
import { registerQboDelivery, decideQboDelivery, type DeliveryDecision } from "@/domains/books/exports/delivery";
import type { ExportMode, ExportTarget } from "@prisma/client";

export async function runBookExportAction(form:FormData) {
  const session=await requireRole("OWNER","ADMIN","ACCOUNTANT");
  const field=(name:string)=>String(form.get(name)??"").trim();
  const input:ExportInput={
    target:field("target") as ExportTarget,mode:field("mode") as ExportMode,
    from:field("from"),to:field("to"),onlyNotYetExported:form.get("onlyNew")==="on",
    qboTenantLabel:field("qboTenantLabel"),qboEdition:field("qboEdition"),
    qboSummaryRiskAccepted:form.get("qboSummaryRiskAccepted")==="on",
  };
  let url="/desk/books/exports";
  try {
    const result=await runExport(session.user.id,input);
    if("blocked" in result)url+="?notice="+encodeURIComponent(result.blocked.join(" | ").slice(0,600));
    else url+="?created="+encodeURIComponent(result.batchId)+(result.alreadyImported?"&imported=1":"");
  } catch(error) {
    url+="?notice="+encodeURIComponent((error instanceof Error?error.message:"Export failed").slice(0,600));
  }
  revalidatePath("/desk/books/exports");
  redirect(url);
}

const notice=(error:unknown)=>(error instanceof Error?error.message:"Accounting delivery failed.").slice(0,260);
export async function registerQboDeliveryAction(form:FormData) {
 const session=await requireRole("OWNER");
 let message="Legacy QuickBooks archive registered as uncertain.";
 try {
  await registerQboDelivery(session.user.id,String(form.get("batchId")??""),
    String(form.get("tenantLabel")??""),String(form.get("edition")??""));
 } catch(error) {message=notice(error);}
 revalidatePath("/desk/books/exports");
 redirect("/desk/books/exports?notice="+encodeURIComponent(message));
}
export async function decideQboDeliveryAction(form:FormData) {
 const session=await requireRole("OWNER");
 let message="Delivery decision recorded. Review any remote imports before retrying.";
 try {
  await decideQboDelivery(session.user.id,{
    deliveryId:String(form.get("deliveryId")??""),
    expectedVersion:Number(form.get("expectedVersion")),
    decision:String(form.get("decision")??"") as DeliveryDecision,
    reference:String(form.get("reference")??""),
    note:String(form.get("note")??""),
    importedCount:Number(form.get("importedCount")),
    balanced:form.get("balanced")==="on",
    bankMatched:form.get("bankMatched")==="on",
    statementChecked:form.get("statementChecked")==="on",
    neverStarted:form.get("neverStarted")==="on",
  });
 } catch(error) {message=notice(error);}
 revalidatePath("/desk/books/exports");
 redirect("/desk/books/exports?notice="+encodeURIComponent(message));
}
