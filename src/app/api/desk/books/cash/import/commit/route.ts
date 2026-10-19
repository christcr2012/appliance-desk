import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { commitBankImport,type BankImportChoices } from "@/domains/books/cash/import";
import type { BankCsvMapping } from "@/domains/books/cash/csv";

export const runtime="nodejs";
export async function POST(request:Request){
 const session=await getServerSession();
 if(!session||session.user.archivedAt||!["OWNER","ADMIN"].includes(session.user.role))
  return NextResponse.json({error:"Not permitted."},{status:403,headers:{"Cache-Control":"private, no-store"}});
 try{
  const form=await request.formData(),file=form.get("file");
  if(!(file instanceof File)||file.size<5||file.size>5*1024*1024)
   return NextResponse.json({error:"Choose a CSV at most 5 MiB."},{status:400});
  const result=await commitBankImport(session.user.id,
   String(form.get("cashAccountId")??""),
   new Uint8Array(await file.arrayBuffer()),
   JSON.parse(String(form.get("mapping")??"")) as BankCsvMapping,
   String(form.get("token")??""),String(form.get("commandKey")??""),
   JSON.parse(String(form.get("choices")??"{}")) as BankImportChoices);
  return NextResponse.json({importId:result},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){
  return NextResponse.json({error:e instanceof Error?e.message:"Bank CSV was not committed"},
   {status:400,headers:{"Cache-Control":"private, no-store"}});
 }
}
