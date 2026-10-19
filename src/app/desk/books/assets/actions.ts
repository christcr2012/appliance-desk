"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { parseDollarInput } from "@/lib/money-ui";
import {
 enrollBookAsset,postBookDepreciation,retireBookAsset,setBookAssetPolicy,
 setBookDepreciationDefaults,addBookTaxEvidence,
} from "@/domains/books/fixed-assets";

const str=(f:FormData,key:string)=>String(f.get(key)??"").trim();
const int=(f:FormData,key:string)=>Number(str(f,key));
const optionalCents=(f:FormData,key:string):number|null=>{
 const value=str(f,key);
 return value?parseDollarInput(value,1_000_000_000):null;
};
const signedCents=(f:FormData,key:string):number|null=>{
 const value=str(f,key);
 if(!value)return null;
 const negative=value.startsWith("-");
 return (negative?-1:1)*parseDollarInput(negative?value.slice(1):value,1_000_000_000);
};
async function finish(label:string,action:()=>Promise<unknown>){
 let notice="";
 try{await action();notice=label+" saved."}
 catch(error){notice=label+": "+(error instanceof Error?error.message:"Unable to change book evidence");}
 revalidatePath("/desk/books/assets");
 redirect("/desk/books/assets?notice="+encodeURIComponent(notice.slice(0,350)));
}
export async function enrollBookAssetAction(form:FormData){
 const user=(await requireRole("OWNER")).user;
 await finish("Asset enrollment",()=>enrollBookAsset(user.id,str(form,"applianceId"),str(form,"placedDate")));
}
export async function postBookDepreciationAction(form:FormData){
 const user=(await requireRole("OWNER")).user;
 await finish("Book depreciation",()=>postBookDepreciation(user.id,str(form,"applianceId"),str(form,"throughMonth")));
}
export async function retireBookAssetAction(form:FormData){
 const user=(await requireRole("OWNER")).user;
 await finish("Pending-disposition asset",()=>retireBookAsset(user.id,str(form,"applianceId"),
  int(form,"version"),str(form,"intent"),str(form,"retiredDate")));
}
export async function bookAssetPolicyAction(form:FormData){
 const user=(await requireRole("OWNER")).user;
 await finish("Asset policy",()=>setBookAssetPolicy(user.id,str(form,"applianceId"),
  int(form,"version"),int(form,"lifeMonths"),int(form,"salvagePercent")));
}
export async function bookDefaultsAction(form:FormData){
 const user=(await requireRole("OWNER")).user;
 await finish("Book defaults",()=>setBookDepreciationDefaults(user.id,
  int(form,"months"),int(form,"salvagePercent")));
}
export async function bookTaxEvidenceAction(form:FormData){
 const user=(await requireRole("OWNER")).user;
 await finish("CPA tax evidence",()=>addBookTaxEvidence(user.id,str(form,"applianceId"),{
  classification:str(form,"classification"),confidence:str(form,"confidence"),
  originalBasisCents:optionalCents(form,"originalBasis"),
  signedAdjustmentsCents:signedCents(form,"adjustments"),
  allowedDepreciationCents:optionalCents(form,"allowed"),
  section179Cents:optionalCents(form,"section179"),
  bonusDepreciationCents:optionalCents(form,"bonus"),
  evidenceDate:str(form,"evidenceDate"),sourceReference:str(form,"sourceReference"),
  cpaName:str(form,"cpaName"),
 }));
}
