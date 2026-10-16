import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {prisma} from "@/lib/prisma";
import {createEstimateDraft,createEstimateDraftForNewLead} from "@/domains/estimates";
import {saveDeliveryOffers,readOfferedSlots} from "@/domains/orders/delivery";
import {recordPhoneOrderPreference,getPhoneOrder,listPhoneOrders,
  preparePhoneLeadCustomer,
  publicPhoneOrderPrefill,sendPhoneOrderToFinish} from "@/domains/orders/phone-orders";

const uri=new URL(process.env.DATABASE_URL??"postgresql://localhost/disabled");
const testDatabase=process.env.CI==="true"&&
  ["localhost","127.0.0.1"].includes(uri.hostname)&&
  ["/appliance_desk_test","/appliance_desk_test_w25"].includes(uri.pathname);

describe.skipIf(!testDatabase)("W-25 owner-entered phone order never substitutes verbal acceptance",()=>{
  const prefix="w25-"+randomUUID().slice(0,12);
  const ownerId=prefix+"-owner";
  const adminId=prefix+"-admin";
  const clientUserId=prefix+"-client";
  const customerId=prefix+"-customer";
  let quoteId:string;
  let ordinaryId:string;
  let newLeadQuoteId:string;
  let newLeadId:string;
  let convertedCustomerId:string|null=null;
  let convertedUserId:string|null=null;
  beforeAll(async()=>{
    await prisma.user.createMany({data:[
      {id:ownerId,role:"OWNER",email:prefix+"-owner@example.test"},
      {id:adminId,role:"ADMIN",email:prefix+"-admin@example.test"},
      {id:clientUserId,role:"CUSTOMER",email:prefix+"-customer@example.test"},
    ]});
    await prisma.customer.create({data:{id:customerId,userId:clientUserId,
      referralCode:"P25"+prefix.slice(-8)}});
    quoteId=(await createEstimateDraft(ownerId,{customerId,
      title:"Owner phone washer/dryer request",phoneOrder:true})).id;
    ordinaryId=(await createEstimateDraft(ownerId,{customerId,
      title:"Ordinary web estimate"})).id;
    const newly=await createEstimateDraftForNewLead(adminId,{
      contactName:"Caller Prospect",phone:"3035553000",
      email:prefix+"-lead@example.test",isBusiness:false,isPropertyManager:false,
    },{title:"New lead on a phone call",phoneOrder:true});
    newLeadQuoteId=newly.id;
    const lead=await prisma.estimate.findUniqueOrThrow({
      where:{id:newLeadQuoteId},select:{leadId:true},
    });
    newLeadId=lead.leadId!;
  });
  afterAll(async()=>{
    await prisma.auditLog.deleteMany({where:{userId:{in:[ownerId,adminId]}}});
    await prisma.estimate.deleteMany({where:{id:{in:[quoteId,ordinaryId,newLeadQuoteId]}}});
    await prisma.lead.deleteMany({where:{id:newLeadId}});
    if(convertedCustomerId)await prisma.customer.deleteMany({where:{id:convertedCustomerId}});
    if(convertedUserId)await prisma.user.deleteMany({where:{id:convertedUserId}});
    await prisma.customer.deleteMany({where:{id:customerId}});
    await prisma.user.deleteMany({where:{id:{in:[ownerId,adminId,clientUserId]}}});
  });
  it("attributes phone entries on existing customer and new lead but not ordinary estimates",async()=>{
    const existing=await prisma.estimate.findUniqueOrThrow({where:{id:quoteId}});
    expect(existing).toMatchObject({phoneEnteredByUserId:ownerId});
    expect(existing.phoneEnteredAt).toBeInstanceOf(Date);
    const prospect=await prisma.estimate.findUniqueOrThrow({where:{id:newLeadQuoteId}});
    expect(prospect).toMatchObject({phoneEnteredByUserId:adminId});
    expect(prospect.leadId).toBe(newLeadId);
    const ordinary=await prisma.estimate.findUniqueOrThrow({where:{id:ordinaryId}});
    expect(ordinary.phoneEnteredAt).toBeNull();
    const listing=await listPhoneOrders(ownerId);
    expect(listing.some(x=>x.id===quoteId)).toBe(true);
    expect(listing.some(x=>x.id===newLeadQuoteId)).toBe(true);
    expect(listing.some(x=>x.id===ordinaryId)).toBe(false);
  });
  it("denies guest/customer access, foreign ordinary orders and unsupported verbal approval",async()=>{
    await expect(getPhoneOrder(clientUserId,quoteId)).rejects.toThrow(/owner|admin/i);
    await expect(listPhoneOrders(clientUserId)).rejects.toThrow(/owner|admin/i);
    await expect(getPhoneOrder(ownerId,ordinaryId)).rejects.toThrow(/not found/i);
    const chosen={optionId:"33333333-3333-4333-8333-333333333333",
      expectedOfferVersion:1,questions:{
        dryerOutlet:"GAS" as const,washerHookups:"YES" as const,
        stairs:false,crewNotes:"Leave by garage"}};
    await expect(recordPhoneOrderPreference(clientUserId,quoteId,chosen))
      .rejects.toThrow(/owner|admin/i);
    await expect(sendPhoneOrderToFinish(ownerId,quoteId))
      .rejects.toThrow(/machines|delivery/i);
    expect(await prisma.signatureRecord.count({where:{
      agreement:{sourceEstimateId:quoteId}}})).toBe(0);
    expect(await prisma.job.count({where:{customerId}})).toBe(0);
  });
  it("prepares a new phone lead as a nonbinding customer once, without email, signature or charge",async()=>{
    await expect(preparePhoneLeadCustomer(clientUserId,newLeadQuoteId))
      .rejects.toThrow(/owner|admin/i);
    const first=await preparePhoneLeadCustomer(adminId,newLeadQuoteId);
    convertedCustomerId=first.customerId;
    const customer=await prisma.customer.findUniqueOrThrow({where:{id:first.customerId}});
    convertedUserId=customer.userId;
    expect(first.created).toBe(true);
    const again=await preparePhoneLeadCustomer(ownerId,newLeadQuoteId);
    expect(again).toEqual({customerId:first.customerId,created:false});
    const prepared=await prisma.estimate.findUniqueOrThrow({where:{id:newLeadQuoteId}});
    expect(prepared).toMatchObject({customerId:first.customerId,status:"DRAFT",
      phoneEnteredByUserId:adminId,phonePreferredAt:null,respondedAt:null});
    expect(await prisma.signatureRecord.count({where:{
      agreement:{sourceEstimateId:newLeadQuoteId}}})).toBe(0);
    expect(await prisma.job.count({where:{customerId:first.customerId}})).toBe(0);
  });
  it("previews only a current owner-offered option and never creates visit, signature or payment",async()=>{
    const slots=await saveDeliveryOffers(ownerId,quoteId,[
      {date:"2027-05-01",window:"AM"},
      {date:"2027-05-02",window:"PM"},
    ]);
    const row=await prisma.estimate.findUniqueOrThrow({where:{id:quoteId}});
    const offered=readOfferedSlots(row.deliveryOffer);
    const candidate={optionId:offered[1].id,
      expectedOfferVersion:slots.version,questions:{
        dryerOutlet:"FOUR_PRONG" as const,washerHookups:"UNKNOWN" as const,
        stairs:true,crewNotes:"Steps at basement"}};
    await recordPhoneOrderPreference(adminId,quoteId,candidate);
    const updated=await prisma.estimate.findUniqueOrThrow({where:{id:quoteId}});
    expect(updated.phonePreferredAt).toBeInstanceOf(Date);
    expect(updated.deliveryRequestedAt).toBeNull(); // no customer approval
    expect(updated.status).toBe("DRAFT");
    expect(publicPhoneOrderPrefill(updated)).toEqual(candidate);
    const readback=await getPhoneOrder(ownerId,quoteId);
    expect(readback.preferred).toEqual(candidate);
    expect(readback.selectedSource).toBe("OWNER_PHONE_INPUT");
    expect(await prisma.invoice.count({where:{customerId}})).toBe(0);
    expect(await prisma.job.count({where:{customerId}})).toBe(0);
    await expect(sendPhoneOrderToFinish(ownerId,quoteId)).rejects.toThrow(/machines|ready/i);
    const moved=await saveDeliveryOffers(ownerId,quoteId,[{date:"2027-05-05",window:"AM"}]);
    const newer=await prisma.estimate.findUniqueOrThrow({where:{id:quoteId}});
    expect(moved.version).toBe(slots.version+1);
    expect(publicPhoneOrderPrefill(newer)).toBeNull();
    await expect(sendPhoneOrderToFinish(ownerId,quoteId)).rejects.toThrow();
  });
  it("normal web requests are not auto-accepted by the phone helper",async()=>{
    const row=await prisma.estimate.findUniqueOrThrow({where:{id:ordinaryId}});
    expect(publicPhoneOrderPrefill({...row,phonePreferredDelivery:{
      optionId:"33333333-3333-4333-8333-333333333333",expectedOfferVersion:1,
      questions:{dryerOutlet:"GAS",washerHookups:"YES",stairs:false,crewNotes:""},
    }})).toBeNull();
  });
});
