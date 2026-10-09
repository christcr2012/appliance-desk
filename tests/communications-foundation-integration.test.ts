import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BACKUP_TABLES } from "@/domains/backup/manifest";

const endpoint = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(endpoint.hostname) &&
  endpoint.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("COM-L2 additive telecom foundation (real PostgreSQL)", () => {
  const token = randomUUID().replaceAll("-", "").slice(0, 24);
  const owner = `com-l2-${token}`;
  const customer = owner + "-customer";
  const lead = owner + "-lead";
  const contactPointId = owner + "-point";
  const accountId = owner + "-account";
  const email = owner + "@example.test";
  const phone = "+1303555" + token.replace(/\D/g, "").padEnd(4, "1").slice(0,4);

  beforeAll(async () => {
    await prisma.user.create({ data: { id: owner, email, role: "CUSTOMER" } });
    await prisma.customer.create({ data: {
      id: customer, userId: owner, referralCode: owner.slice(0,28),
    } });
    await prisma.lead.create({ data: { id: lead, contactName: "COM test", phone } });
    await prisma.telecomAccount.create({ data: {
      id: accountId, provider: "twilio", environment: "TEST",
      externalAccountId: "TEST" + token, label: "Isolated test",
    } });
    await prisma.contactPoint.create({ data: {
      id: contactPointId, environment: "TEST", channel: "SMS", address: phone,
    } });
  });

  afterAll(async () => {
    await prisma.consentRecord.deleteMany({ where: { leadId: lead } });
    await prisma.contactBinding.deleteMany({ where: { contactPointId } });
    await prisma.messageAttempt.deleteMany({ where: { accountId } });
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: { startsWith: owner } } });
    await prisma.providerEvent.deleteMany({ where: { eventId: { startsWith: owner } } });
    await prisma.businessPhoneNumber.deleteMany({ where: { accountId } });
    await prisma.contactPoint.delete({ where: { id: contactPointId } });
    await prisma.telecomAccount.delete({ where: { id: accountId } });
    await prisma.lead.delete({ where: { id: lead } });
    await prisma.customer.delete({ where: { id: customer } });
    await prisma.user.delete({ where: { id: owner } });
  });

  it("keeps legacy email/event columns while new rows start unconfigured", async () => {
    const account = await prisma.telecomAccount.findUniqueOrThrow({where: {id:accountId}});
    expect(account).toMatchObject({status:"UNCONFIGURED",readiness:{}});
    const delivery = await prisma.messageDelivery.create({data:{
      idempotencyKey:owner+"-legacy-email",channel:"EMAIL",purpose:"TRANSACTIONAL",
      recipientType:"Customer",recipientId:customer,recipientAddress:email,templateKey:"legacy",
    }});
    expect(delivery).toMatchObject({state:"PENDING",telecomAccountId:null,currentAttemptId:null});
    const event = await prisma.providerEvent.create({data:{
      provider:"resend",eventId:owner+"-legacy-event",type:"email.sent",
      summary:{messageId:"test"},processedAt:new Date(),
    }});
    // Rows created after the migration use RECEIVED; pre-migration processed
    // history is explicitly backfilled to LEGACY_HANDLED by the migration.
    expect(event.disposition).toBe("RECEIVED");
    const stored = await prisma.messageDelivery.findUniqueOrThrow({where:{id:delivery.id}});
    expect(stored.recipientAddress).toBe(email);
  });

  it("requires exactly one binding subject at the database boundary", async () => {
    await expect(prisma.contactBinding.create({data:{
      contactPointId,source:"STAFF",
    }})).rejects.toThrow();
    await expect(prisma.contactBinding.create({data:{
      contactPointId,customerId:customer,leadId:lead,source:"STAFF",
    }})).rejects.toThrow();
    const valid = await prisma.contactBinding.create({data:{
      contactPointId,customerId:customer,source:"STAFF",
    }});
    expect(valid.customerId).toBe(customer);
  });

  it("prevents a duplicate active binding but allows revoked history", async () => {
    await expect(prisma.contactBinding.create({data:{
      contactPointId,customerId:customer,source:"STAFF",
    }})).rejects.toThrow();
    await prisma.contactBinding.updateMany({
      where:{contactPointId,customerId:customer,revokedAt:null},
      data:{revokedAt:new Date()},
    });
    const replacement = await prisma.contactBinding.create({data:{
      contactPointId,customerId:customer,source:"SELF_SERVICE",
    }});
    expect(replacement.revokedAt).toBeNull();
  });

  it("serializes competing primary phone numbers via a partial unique index", async () => {
    const result = await Promise.allSettled([
      prisma.businessPhoneNumber.create({data:{
        accountId,address:"+13035550111",providerNumberId:owner+"-p1",isPrimary:true,
      }}),
      prisma.businessPhoneNumber.create({data:{
        accountId,address:"+13035550112",providerNumberId:owner+"-p2",isPrimary:true,
      }}),
    ]);
    expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const primary = await prisma.businessPhoneNumber.findFirstOrThrow({where:{accountId,isPrimary:true}});
    await prisma.businessPhoneNumber.update({where:{id:primary.id},data:{retiredAt:new Date()}});
    const second = await prisma.businessPhoneNumber.create({data:{
      accountId,address:"+13035550113",providerNumberId:owner+"-p3",isPrimary:true,
    }});
    expect(second.isPrimary).toBe(true);
  });

  it("enforces positive attempt numbers, sequence and provider resource uniqueness", async () => {
    const delivery = await prisma.messageDelivery.create({data:{
      idempotencyKey:owner+"-attempt",channel:"SMS",purpose:"TRANSACTIONAL",
      recipientType:"Customer",recipientId:customer,recipientAddress:phone,templateKey:"test",
    }});
    await expect(prisma.messageAttempt.create({data:{
      deliveryId:delivery.id,accountId,attemptNumber:0,
      operationKey:owner+"-zero",requestHash:"dummy",
    }})).rejects.toThrow();
    const first = await prisma.messageAttempt.create({data:{
      deliveryId:delivery.id,accountId,attemptNumber:1,
      operationKey:owner+"-one",requestHash:"dummy",providerResourceId:"SM"+token,
    }});
    await expect(prisma.messageAttempt.create({data:{
      deliveryId:delivery.id,accountId,attemptNumber:1,
      operationKey:owner+"-duplicate-sequence",requestHash:"dummy",
    }})).rejects.toThrow();
    await expect(prisma.messageAttempt.create({data:{
      deliveryId:delivery.id,accountId,attemptNumber:2,
      operationKey:owner+"-duplicate-provider",requestHash:"dummy",
      providerResourceId:first.providerResourceId,
    }})).rejects.toThrow();
    await prisma.messageDelivery.update({
      where:{id:delivery.id},data:{currentAttemptId:first.id},
    });
    expect((await prisma.messageDelivery.findUniqueOrThrow({where:{id:delivery.id}}))
      .currentAttemptId).toBe(first.id);
    await prisma.messageDelivery.update({where:{id:delivery.id},data:{currentAttemptId:null}});
  });

  it("keeps empty policy and provider configuration non-authoritative for sending", async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where:{id:"singleton"},
      select:{communicationsPolicy:true,communicationsPolicyVersion:true,customerSmsEnabled:true},
    });
    expect(settings.communicationsPolicy).toEqual({});
    expect(settings.communicationsPolicyVersion).toBeGreaterThan(0);
    expect(settings.customerSmsEnabled).toBe(false);
    for (const table of ["telecomAccount","businessPhoneNumber","contactPoint","contactBinding","messageAttempt"])
      expect(BACKUP_TABLES).toContain(table);
  });
});
