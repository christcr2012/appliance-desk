import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { attachFrozenZeroOffer } from "./support/frozen-zero-offer";
import { expect, test } from "@playwright/test";

const customerFile = path.resolve("e2e/.auth/customer.json");
const ownerFile = path.resolve("e2e/.auth/owner.json");

test.describe.configure({mode:"serial"});

test.describe("W-26 safely stored customer language and owner draft translations", () => {
  test("account preference is saved without bypassing Spanish publication review", async ({ browser }) => {
    test.skip(!process.env.CI || !fs.existsSync(customerFile),
      "Disposable CI authenticated customer only; never update production records.");
    const context = await browser.newContext({ storageState: customerFile });
    const page = await context.newPage();
    try {
      await page.setViewportSize({ width: 360, height: 850 });
      await page.goto("/account/settings");
      const language = page.getByLabel("Preferred language / Idioma preferido");
      await expect(language).toBeVisible();
      await language.selectOption("es");
      await page.getByRole("button", { name: "Save language / Guardar idioma" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Language preference saved" })).toBeVisible();
      await page.reload();
      await expect(page.getByLabel("Preferred language / Idioma preferido")).toHaveValue("es");
      await expect(page.getByText(/English remains the controlling agreement/)).toBeVisible();
    } finally {
      // The shared CI customer fixture must return to its original language.
      await page.getByLabel("Preferred language / Idioma preferido").selectOption("en");
      await page.getByRole("button", { name: "Save language / Guardar idioma" }).click();
      await context.close();
    }
  });

  test("owner can inspect unpublished translation drafts without public activation", async ({ browser }) => {
    test.skip(!process.env.CI || !fs.existsSync(ownerFile),
      "Disposable CI authenticated owner only.");
    const context = await browser.newContext({ storageState: ownerFile });
    const page = await context.newPage();
    try {
      await page.goto("/desk/settings?section=notifications");
      // AR-8: the Spanish review and drafts open from their panel row.
      await page.getByRole("button", { name: /Spanish wording/ }).click();
      await expect(page.getByText(/English remains the default/)).toBeVisible();
      await expect(page.getByText("Draft translations")).toBeVisible();
      await expect(page.getByRole("button", { name: "Enable reviewed Spanish" })).toBeDisabled();
      await expect(page.getByText(/Engineering surface coverage:.*All original routes implemented/)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

// These synthetic attestations can be created only in the CI loopback database.
// They test the real gate and routes; they never stand in for fluent/legal approval.
test("complete bilingual customer routes, signing evidence and revoked-review fallback",async({browser},info)=>{
  test.setTimeout(60_000);
  const url=new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
  test.skip(process.env.CI!=="true" || !["localhost","127.0.0.1"].includes(url.hostname) || url.pathname!=="/appliance_desk_test" || !fs.existsSync(ownerFile) || !fs.existsSync(customerFile),"Disposable CI database and authenticated fixtures only");
  const {prisma}=await import("../src/lib/prisma");
  const owner=await prisma.user.findFirstOrThrow({where:{role:"OWNER"}});
  const customer=await prisma.customer.findFirstOrThrow({where:{user:{email:process.env.TEST_CUSTOMER_EMAIL!}},include:{serviceAddresses:true,user:true}});
  const oldReview=await prisma.customerLanguageReview.findUnique({where:{language:"es"}});
  const oldDrafts=await prisma.customerTranslationDraft.findMany();
  const marker="w26-"+randomUUID();const agreementId=marker+"-agreement",signatureId=marker+"-signature",estimateId=marker+"-estimate";
  const englishTerms="Synthetic W-26 original English ending terms.";
  const ownerNote="Synthetic owner note with $60.50 unchanged.";
  const ownerContext=await browser.newContext({storageState:ownerFile});
  const context=await browser.newContext({storageState:customerFile,viewport:{width:390,height:844}});
  const ownerPage=await ownerContext.newPage();const page=await context.newPage();
  try {
    await prisma.customer.update({where:{id:customer.id},data:{preferredLanguage:"en"}});
    await prisma.rentalAgreement.create({data:{id:agreementId,customerId:customer.id,serviceAddressId:customer.serviceAddresses[0].id,status:"AWAITING_SIGNATURE",termMonths:12,
      termsSnapshot:{shape:1,termination:{feeCents:4500,feePercent:null,feeCapCents:null,noticeDays:30,unusedTerm:"CREDIT",termsText:englishTerms},autoRenew:null},
      lines:{create:{label:"Recorded W-26 washer",monthlyPriceCents:4000,listPriceCents:4000}},signature:{create:{id:signatureId,provider:"internal"}}}});
    await attachFrozenZeroOffer(prisma,agreementId,customer.serviceAddresses[0].id,signatureId);
    await prisma.estimate.create({data:{id:estimateId,title:"Synthetic W-26 quote",clientMessage:ownerNote,customerId:customer.id,createdByUserId:owner.id,status:"SENT",sentAt:new Date(),validUntil:new Date(Date.now()+86400000),
      lineItems:{create:{description:"Recorded W-26 washer",quantity:1,monthlyPriceCents:6050,oneTimeFeeCents:4500}}}});
    await ownerPage.goto("/desk/settings?section=notifications");
    const sources=await ownerPage.locator('form:has(input[name="kind"])').evaluateAll(forms=>forms.map(form=>{
      const value=(name:string)=>(form.querySelector(`[name="${name}"]`) as HTMLInputElement|HTMLTextAreaElement).value;
      return {kind:value("kind"),key:value("key"),digest:value("digest"),spanish:value("spanish"),english:(form.querySelector('textarea[readonly]') as HTMLTextAreaElement).value};
    }));
    expect(sources.length).toBeGreaterThan(20);
    for(const source of sources) {
      const spanish=source.english===ownerNote?"Nota informativa del propietario con $60.50 sin cambios.":source.english===englishTerms?"Condiciones informativas de finalización para la prueba W-26.":source.spanish || "Texto sintético de prueba: "+source.english;
      await prisma.customerTranslationDraft.upsert({where:{sourceKind_sourceKey:{sourceKind:source.kind,sourceKey:source.key}},
        create:{sourceKind:source.kind,sourceKey:source.key,englishDigest:source.digest,spanishText:spanish,editedByUserId:owner.id},
        update:{englishDigest:source.digest,spanishText:spanish}});
    }
    await ownerPage.reload();
    const digest=await ownerPage.locator('input[name="expectedDigest"]').inputValue();
    const evidence={copyDigest:digest,reviewerName:"SYNTHETIC CI ONLY",reviewReference:"Not actual fluent approval",reviewedAt:new Date(),legalReviewerName:"SYNTHETIC CI ONLY",legalReviewReference:"Not actual counsel approval",legalReviewedAt:new Date(),publishedAt:new Date(),publishedByUserId:owner.id};
    await prisma.customerLanguageReview.upsert({where:{language:"es"},create:{language:"es",...evidence},update:evidence});
    await page.goto("/account/settings");
    await page.getByLabel("Preferred language / Idioma preferido").selectOption("es");
    await page.getByRole("button",{name:"Save language / Guardar idioma"}).click();
    await expect(page.getByRole("heading",{name:"Cuenta",exact:true})).toBeVisible();
    expect((await prisma.customer.findUniqueOrThrow({where:{id:customer.id}})).preferredLanguage).toBe("es");
    for(const [route,heading] of [["/account","Su cuenta de alquiler"],["/account/rentals","Mis alquileres"],["/account/billing","Facturación"],["/account/maintenance","Mantenimiento"],["/account/properties","Mis propiedades y contactos locales"],["/account/settings/privacy","Solicitudes de privacidad"]]) {
      await page.goto(route);await expect(page.getByRole("heading",{name:heading,exact:true}).first()).toBeVisible();
      expect(await page.locator('body').innerText()).not.toContain("undefined");
    }
    await page.goto("/account/billing");await expect(page.getByRole("button",{name:"Administrar método de pago y facturación"})).toBeVisible();
    await page.goto("/account/maintenance");await page.locator("#problem").fill("   ");await page.getByRole("button",{name:"Enviar solicitud"}).click();
    await expect(page.getByRole("alert").filter({hasText:"Describa su solicitud"})).toContainText("Describa");
    await page.goto("/estimate/"+estimateId);
    await expect(page.getByText("$60.50",{exact:false}).first()).toBeVisible();
    await page.getByRole("button",{name:"Español",exact:true}).click();
    await expect(page.getByRole("button",{name:"Solicitar cambios",exact:true})).toBeVisible();
    await expect(page.getByText("Nota informativa del propietario con $60.50 sin cambios.",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Solicitar cambios",exact:true}).click();
    await page.getByLabel("¿Qué desea cambiar?").fill("Solicitud sintética de prueba para cambiar la fecha.");
    await page.getByRole("button",{name:"Enviar solicitud",exact:true}).click();
    await expect(page.getByText("Gracias. Recibimos su solicitud.")).toBeVisible();
    expect((await prisma.estimate.findUniqueOrThrow({where:{id:estimateId}})).status).toBe("CHANGES_REQUESTED");
    await page.goto("/sign/"+signatureId+"?language=es");
    await expect(page.getByRole("heading",{name:"Revise y firme su contrato de alquiler"})).toBeVisible();
    await expect(page.getByText(englishTerms,{exact:true})).toBeVisible();
    await expect(page.getByText("Condiciones informativas de finalización para la prueba W-26.",{exact:true})).toBeVisible();
    expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
    await info.attach("w26-spanish-signing-mobile",{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
    await page.getByLabel("Su nombre legal completo").fill("Synthetic W26 Customer");
    await page.getByLabel("Su correo electrónico").fill(customer.user.email);
    await page.getByRole("checkbox").check();
    await page.getByRole("button",{name:"Firmar contrato",exact:true}).click();
    await expect(page.getByText("Gracias. Su contrato está firmado.")).toBeVisible();
    const signed=await prisma.signatureRecord.findUniqueOrThrow({where:{id:signatureId}});
    expect(signed.shownLanguage).toBe("en");expect(signed.interfaceLanguage).toBe("es");expect(signed.translationCopyDigest).toBe(digest);
    expect(signed.informationalTerms).toEqual([{english:englishTerms,spanish:"Condiciones informativas de finalización para la prueba W-26."}]);
    await expect(prisma.signatureRecord.update({where:{id:signatureId},data:{interfaceLanguage:"en"}})).rejects.toThrow("Historical signed language evidence");
    await page.goto("/account?signingPayment=processing");await expect(page.getByRole("status").filter({hasText:"no confirma el pago"})).toBeVisible();
    await ownerPage.goto("/desk/settings?section=notifications");await expect(ownerPage.getByRole("button",{name:"Record fluent review"})).toBeVisible();
    // Withdrawing approval changes only new UI/dispatch, never signed history or saved preference.
    await prisma.customerLanguageReview.update({where:{language:"es"},data:{publishedAt:null}});
    await page.goto("/account/settings");await expect(page.getByText(/English remains the controlling agreement/)).toBeVisible();
    await expect(page.getByLabel("Preferred language / Idioma preferido")).toHaveValue("es");
    expect((await prisma.signatureRecord.findUniqueOrThrow({where:{id:signatureId}})).translationCopyDigest).toBe(digest);
  } finally {
    await prisma.customer.update({where:{id:customer.id},data:{preferredLanguage:customer.preferredLanguage}});
    await prisma.job.deleteMany({where:{agreementId}});
    await prisma.documentArtifact.deleteMany({where:{subjectId:agreementId}});
    await prisma.agreementSigningPayment.deleteMany({where:{agreementId}});
    await prisma.signatureRecord.deleteMany({where:{id:signatureId}});
    await prisma.agreementSigningCharge.deleteMany({where:{agreementId}});
    await prisma.rentalLine.deleteMany({where:{agreementId}});
    await prisma.rentalAgreement.deleteMany({where:{id:agreementId}});
    await prisma.estimateLineItem.deleteMany({where:{estimateId}});await prisma.estimate.deleteMany({where:{id:estimateId}});
    await prisma.customerTranslationDraft.deleteMany();if(oldDrafts.length)await prisma.customerTranslationDraft.createMany({data:oldDrafts});
    if(oldReview)await prisma.customerLanguageReview.update({where:{language:"es"},data:oldReview});else await prisma.customerLanguageReview.deleteMany({where:{language:"es"}});
    await context.close();await ownerContext.close();
  }
});
