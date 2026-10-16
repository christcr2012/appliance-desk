import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const m=vi.hoisted(()=>({language:"en" as "en"|"es",portal:vi.fn(),statement:vi.fn()}));
vi.mock("@/domains/language/portal",()=>({portalLanguage:async()=>m.language}));
vi.mock("@/lib/session",()=>({getServerSession:async()=>({user:{id:"customer-user"}})}));
vi.mock("@/domains/portal",()=>({getPortalData:m.portal}));
vi.mock("@/lib/prisma",()=>({prisma:{}}));
vi.mock("@/domains/language/legal",async(importOriginal)=>({
 ...await importOriginal<typeof import("@/domains/language/legal")>(),
 agreementLanguage:async(language:"en"|"es",texts:string[])=>({language,translations:language==="es"?texts.map(english=>({english,spanish:"Condiciones informativas revisadas para esta prueba."})):[]}),
}));
vi.mock("@vercel/blob/client",()=>({upload:vi.fn()}));
vi.mock("@/domains/billing",()=>({getCustomerStatement:m.statement}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn(),push:vi.fn()})}));
import AccountRentalsPage from "@/app/account/rentals/page";
import AccountBillingPage from "@/app/account/billing/page";
import { CustomerLanguageProvider } from "@/domains/language/client-portal";
import { LocationsPanel } from "@/components/locations/locations-panel";
import { NewRequestForm } from "@/app/account/maintenance/new-request-form";
import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { describeSnapshotTerms } from "@/domains/agreements/terms-snapshot";
function html(node:React.ReactNode,language:"en"|"es") {return renderToStaticMarkup(<CustomerLanguageProvider language={language}>{node}</CustomerLanguageProvider>);}
beforeEach(()=>{m.language="en";m.portal.mockResolvedValue({id:"own-customer",jobs:[],jobsHasMore:false,rentalAgreements:[{
 id:"own-agreement",status:"DRAFT",serviceAddress:{line1:"100 Test St",city:"Greeley"},termMonths:12,startDate:null,terminationRequestedAt:null,terminationEffectiveOn:null,termsSnapshot:null,renewalPreference:null,jobs:[],freeMonthGranted:false,depositCents:15000,
 lines:[{id:"line",label:"Recorded English washer",monthlyPriceCents:6050,listPriceCents:6050,prepayDiscountCentsPerMonth:0,assignments:[]}],
 signingPaymentSummary:{setupFeeCents:4500,setupTaxCents:300,downPaymentCents:6050,totalCents:10850,status:"AWAITING_PAYMENT",receivedOn:null},
}]});m.statement.mockResolvedValue({totalBalanceCents:10850,properties:[{serviceAddressId:"own-address",addressLabel:"100 Test St",invoices:[{id:"invoice",invoiceNumber:123,status:"PARTIALLY_PAID",billingPeriodStart:null,amountPaidCents:1000,balanceCents:10850,isLocalInvoice:true}]}]});});
describe.each(["en","es"] as const)("W-26 actual nested customer rendering in %s",language=>{
 it("renders rentals and immutable unpaid proof in the selected language",async()=>{
  m.language=language;const output=html(await AccountRentalsPage({searchParams:Promise.resolve({})}),language);
  expect(output).toContain("Recorded English washer");expect(output).toContain("$60.50");expect(output).toContain("$108.50");
  expect(output).toContain(language==="es"?"Importe firmado al contratar":"Signed signing amount");
  expect(output).toContain(language==="es"?"pendiente de pago verificado":"awaiting verified payment");
  expect(output).not.toContain("recorded as received");
 });
 it("shows the reviewed legal sidecar beside exact recorded English without rewriting it",async()=>{
  m.language=language;
  const data=await m.portal();const english="Recorded original English ending terms.";
  const snapshot={shape:1,termination:{feeCents:4500,feePercent:null,feeCapCents:null,noticeDays:30,unusedTerm:"CREDIT",termsText:english},autoRenew:null};
  data.rentalAgreements[0].termsSnapshot=snapshot;m.portal.mockResolvedValue(data);
  const output=html(await AccountRentalsPage({searchParams:Promise.resolve({})}),language);
  expect(output).toContain(english);
  if(language==="es")expect(output).toContain("Condiciones informativas revisadas para esta prueba.");
  else expect(output).not.toContain("Condiciones informativas revisadas para esta prueba.");
  expect(data.rentalAgreements[0].termsSnapshot).toEqual(snapshot);
 });
 it("renders billing balances/status while preserving invoice identity and values",async()=>{
  m.language=language;const output=html(await AccountBillingPage(),language);
  expect(output).toContain("123");expect(output).toContain("$108.50");
  expect(output).toContain(language==="es"?"Pagado parcialmente":"Partially paid");
  expect(output).toContain(language==="es"?"pendiente de pago":"currently owed");
 });
 it("renders customer location permissions without owner retention/purge controls",()=>{
  const permission={deliveryPickup:false,maintenance:false,swaps:false,copyClient:false,appointmentConfirmer:"CLIENT" as const};
  const locations={id:"own-customer",permission,serviceAddresses:[]} as unknown as React.ComponentProps<typeof LocationsPanel>["locations"];
  const output=html(createElement(LocationsPanel,{customerId:"own-customer",locations,owner:false,retentionMonths:null}),language);
  expect(output).toContain(language==="es"?"Guardar permisos de la cuenta":"Save account permissions");
  expect(output).toContain(language==="es"?"¿Quién confirma las citas?":"Who confirms appointments?");
  expect(output).not.toContain("Irreversible erasure");
 });
 it("renders complete maintenance priority and upload controls",()=>{
  const output=html(createElement(NewRequestForm,{customerId:"own-customer",appliances:[],requestTitle:language==="es"?"Informar un problema":"Report a problem"}),language);
  expect(output).toContain(language==="es"?"Baja — cuando sea conveniente":"Low — whenever&#x27;s convenient");
  expect(output).toContain(language==="es"?"Enviar solicitud":"Submit request");expect(output).toContain(language==="es"?"Agregar una foto":"Add a photo");
 });
 it.each(["processing","cancelled"])("payment return %s never invents a receipt",state=>{
  const output=html(createElement(PaymentReturnNotice,{language,state}),language);
  expect(output).toContain(language==="es"?(state==="cancelled"?"No se completó el pago":"no confirma el pago"):(state==="cancelled"?"Payment was not completed":"does not confirm payment"));
 });
 it("localizes fixed term numeric disclosures while retaining exact English terms",()=>{
  const snapshot={shape:1,termination:{feeCents:4500,feePercent:null,feeCapCents:null,noticeDays:30,unusedTerm:"REFUND",termsText:"Recorded governing English text"},autoRenew:null};
  const output=describeSnapshotTerms(snapshot,language);
  expect(output.ending?.lines.join(" ")).toContain("$45");expect(output.ending?.lines.join(" ")).toContain("30");
  expect(output.ending?.termsText).toBe(snapshot.termination.termsText);
 });
});
