import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveDeliveryOffers, readOfferedSlots,
  recordEstimateDeliverySelectionInTx } from "@/domains/orders/delivery";
import { declineOfferedEstimate } from "@/domains/orders/delivery-response";
import { requestPaidDeliveryInTx } from "@/domains/orders/settled-delivery";
const uri=new URL(process.env.DATABASE_URL??"postgresql://localhost/disabled");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(uri.hostname)
  &&uri.pathname==="/appliance_desk_test";
describe.skipIf(!enabled)("W-24 owner options, public responses and unpaid request isolation (Postgres)",()=>{
  const prefix="w24-"+randomUUID().slice(0,12);
  const ownerId=prefix+"-owner";
  const customerUser=prefix+"-user";
  const customerId=prefix+"-customer";
  let addressId:string;
  const estimates:string[]=[];
  const slots=[
    {date:"2027-04-19",window:"AM" as const},
    {date:"2027-04-20",window:"PM" as const},
  ];
  beforeAll(async()=>{
    await prisma.user.createMany({data:[
      {id:ownerId,role:"OWNER",email:prefix+"-o@example.test"},
      {id:customerUser,role:"CUSTOMER",email:prefix+"-c@example.test"},
    ]});
    await prisma.customer.create({data:{id:customerId,userId:customerUser,
      referralCode:"W24"+prefix.slice(-8)}});
    addressId=(await prisma.serviceAddress.create({data:{customerId,
      line1:"702 W24 Sample Rd",city:"Greeley",zip:"80631"}})).id;
  });
  afterAll(async()=>{
    await prisma.staffTask.deleteMany({where:{sourceKey:{startsWith:"estimate-declined:"+prefix}}});
    await prisma.auditLog.deleteMany({where:{entityId:{in:estimates}}});
    await prisma.estimate.deleteMany({where:{id:{in:estimates}}});
    await prisma.serviceAddress.deleteMany({where:{id:addressId}});
    await prisma.customer.deleteMany({where:{id:customerId}});
    await prisma.user.deleteMany({where:{id:{in:[ownerId,customerUser]}}});
  });
  async function createEstimate(status:"DRAFT"|"SENT"="DRAFT") {
    const row=await prisma.estimate.create({data:{id:prefix+"-"+estimates.length,
      customerId,createdByUserId:ownerId,title:"W24 test offer",status}});
    estimates.push(row.id); return row;
  }
  it("only authorized owner can offer up to four unique date/windows and rotates version",async()=>{
    const quote=await createEstimate();
    await expect(saveDeliveryOffers(customerUser,quote.id,slots)).rejects.toThrow(/owner/i);
    const first=await saveDeliveryOffers(ownerId,quote.id,slots);
    expect(first).toMatchObject({version:1,count:2});
    const second=await saveDeliveryOffers(ownerId,quote.id,slots.slice(0,1));
    expect(second.version).toBe(2);
    const persisted=await prisma.estimate.findUniqueOrThrow({where:{id:quote.id}});
    expect(readOfferedSlots(persisted.deliveryOffer)).toHaveLength(1);
    await expect(saveDeliveryOffers(ownerId,quote.id,[slots[0],slots[0]])).rejects.toThrow(/unique/i);
    await expect(saveDeliveryOffers(ownerId,quote.id,[])).rejects.toThrow(/between/i);
  });
  it("stores delivery questions in same transaction but never books a visit",async()=>{
    const quote=await createEstimate();
    const offer=await saveDeliveryOffers(ownerId,quote.id,slots);
    const persisted=await prisma.estimate.findUniqueOrThrow({where:{id:quote.id}});
    const chosen=readOfferedSlots(persisted.deliveryOffer)[0];
    const request={optionId:chosen.id,expectedOfferVersion:offer.version,questions:{
      dryerOutlet:"THREE_PRONG" as const,stairs:false,
      washerHookups:"YES" as const,crewNotes:"Porch"}};
    const selected=await prisma.$transaction(tx=>
      recordEstimateDeliverySelectionInTx(tx,persisted,request));
    expect(selected.slot.id).toBe(chosen.id);
    const stored=await prisma.estimate.findUniqueOrThrow({where:{id:quote.id}});
    expect(stored.deliveryRequestedAt).toBeInstanceOf(Date);
    expect(await prisma.job.count({where:{customerId}})).toBe(0);
    const changed=await saveDeliveryOffers(ownerId,quote.id,slots);
    await expect(prisma.$transaction(tx=>
      recordEstimateDeliverySelectionInTx(tx,{
        ...stored, deliveryOfferVersion:changed.version,
      },request))).rejects.toThrow(/changed/i);
  });
  it("declines one sent quote, records private To do and prevents replay",async()=>{
    const quote=await createEstimate("SENT");
    await declineOfferedEstimate(quote.id,"Delivery timing does not work");
    const declined=await prisma.estimate.findUniqueOrThrow({where:{id:quote.id}});
    expect(declined).toMatchObject({status:"DECLINED",declineReason:"Delivery timing does not work"});
    expect(await prisma.staffTask.count({where:{sourceKey:"estimate-declined:"+quote.id}})).toBe(1);
    await expect(declineOfferedEstimate(quote.id,"Again")).rejects.toThrow(/no longer/i);
    expect(await prisma.job.count({where:{customerId}})).toBe(0);
  });
  it("never creates a visit before a settled, exact signed obligation",async()=>{
    const quote=await createEstimate("SENT");
    const agreement=await prisma.rentalAgreement.create({data:{
      customerId,serviceAddressId:addressId,sourceEstimateId:quote.id,status:"ACTIVE",
    }});
    try {
      expect(await prisma.$transaction(tx=>requestPaidDeliveryInTx(tx,agreement.id)))
        .toBeNull();
      expect(await prisma.job.count({where:{agreementId:agreement.id}})).toBe(0);
    } finally {
      await prisma.rentalAgreement.delete({where:{id:agreement.id}});
    }
  });
});
