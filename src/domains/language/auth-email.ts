import type { CustomerLanguage } from "./copy";
import { TRANSACTIONAL_COPY, messageText } from "./transactional-copy";

/** Only a real customer preference may affect credential mail. Staff remain English. */
export async function credentialEmailCopy(user:{id:string;name?:string|null},url:string,kind:"password"|"verify") {
 const {allSpanishSurfacesReady}=await import("./readiness");
 let language:CustomerLanguage="en";
 if(allSpanishSurfacesReady) {
  const {prisma}=await import("@/lib/prisma");
  const customer=await prisma.customer.findUnique({where:{userId:user.id},select:{id:true,user:{select:{role:true}}}});
  if(customer?.user?.role==="CUSTOMER") {
   const {customerMessageLanguage}=await import("./message-language");
   language=await customerMessageLanguage(customer.id);
  }
 }
 const catalog=language==="en"?TRANSACTIONAL_COPY.en:await (await import("./runtime")).activeMessageCatalog(language);
 const link=credentialLanguageLink(url,language);
 return {subject:catalog[kind==="password"?"passwordSubject":"verifySubject"],
  text:[messageText(language,"quoteHello",{name:user.name?` ${user.name}`:""},catalog),catalog[kind==="password"?"passwordIntro":"verifyIntro"],link,catalog[kind==="password"?"passwordIgnore":"verifyIgnore"]].join("\n\n"),
  actionLabel:catalog[kind==="password"?"passwordAction":"verifyAction"]};
}
export function credentialLanguageLink(url:string,language:CustomerLanguage) {
 if(language==="en") return url;
 const target=new URL(url);
 const callback=target.searchParams.get("callbackURL");
 if(callback) {
  const destination=new URL(callback,target.origin);destination.searchParams.set("language",language);
  target.searchParams.set("callbackURL",destination.toString());
 } else target.searchParams.set("language",language);
 return target.toString();
}
