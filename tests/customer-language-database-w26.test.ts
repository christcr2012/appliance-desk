import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { chooseCustomerLanguage, readCustomerLanguage } from "@/domains/language";

const address = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const eligible = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(address.hostname) &&
  address.pathname === "/appliance_desk_test";

describe.skipIf(!eligible)("W-26 customer and translation persistence on isolated PostgreSQL", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const actor = "w26-user-" + suffix;
  const foreign = "w26-foreign-" + suffix;
  const customerId = "w26-customer-" + suffix;
  const foreignCustomerId = "w26-other-" + suffix;
  const agreementId = "w26-agreement-" + suffix;
  const serviceId = "w26-service-" + suffix;
  const signatureId = "w26-signature-" + suffix;
  const translationKey = "w26-fixture-" + suffix;

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: actor, email: suffix + "-w26@example.test", role: "CUSTOMER" },
      { id: foreign, email: suffix + "-w26-other@example.test", role: "CUSTOMER" },
    ] });
    await prisma.customer.createMany({ data: [
      { id: customerId, userId: actor, referralCode: "W26A" + suffix },
      { id: foreignCustomerId, userId: foreign, referralCode: "W26B" + suffix },
    ] });
  });
  afterAll(async () => {
    await prisma.customerTranslationDraft.deleteMany({ where: { sourceKey: translationKey } });
    await prisma.signatureRecord.deleteMany({where:{id:signatureId}});
    await prisma.rentalAgreement.deleteMany({where:{id:agreementId}});
    await prisma.serviceAddress.deleteMany({where:{id:serviceId}});
    await prisma.customer.deleteMany({ where: { id: { in: [customerId, foreignCustomerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [actor, foreign] } } });
  });

  it("defaults existing customer preferences to English and retains typed Spanish", async () => {
    expect(await readCustomerLanguage(actor)).toBe("en");
    expect(await chooseCustomerLanguage(actor, "es")).toBe(true);
    expect(await readCustomerLanguage(actor)).toBe("es");
    expect(await readCustomerLanguage(foreign)).toBe("en");
  });
  it("scopes updates to authenticated user and refuses unknown identities", async () => {
    expect(await chooseCustomerLanguage("does-not-exist", "es")).toBe(false);
    expect(await readCustomerLanguage(foreign)).toBe("en");
  });
  it("persists Spanish draft revision evidence without publishing any content", async () => {
    const draft = await prisma.customerTranslationDraft.create({
      data: {
        sourceKind: "SITE", sourceKey: translationKey,
        englishDigest: "e".repeat(64), spanishText: "Texto revisado",
        editedByUserId: actor,
      },
    });
    expect(draft.revision).toBe(1);
    expect(draft.spanishText).toBe("Texto revisado");
    expect(draft.englishDigest).toBe("e".repeat(64));
  });
  it("preserves immutable legal/interface evidence when customer preference changes", async () => {
    await prisma.serviceAddress.create({data:{id:serviceId,customerId,line1:"100 Synthetic Test St",city:"Greeley",zip:"80631"}});
    await prisma.rentalAgreement.create({data:{id:agreementId,customerId,serviceAddressId:serviceId,status:"DRAFT"}});
    await prisma.signatureRecord.create({data:{id:signatureId,agreementId,provider:"internal",signedAt:new Date(),shownLanguage:"en",interfaceLanguage:"es",translationCopyDigest:"a".repeat(64),informationalTerms:[{english:"Synthetic English terms",spanish:"Condiciones sintéticas"}]}});
    await chooseCustomerLanguage(actor,"en");
    const original=await prisma.signatureRecord.findUniqueOrThrow({where:{id:signatureId}});
    expect(original.shownLanguage).toBe("en");expect(original.interfaceLanguage).toBe("es");
    expect(original.translationCopyDigest).toBe("a".repeat(64));
    for (const data of [{signedAt:null},{shownLanguage:"es"},{interfaceLanguage:"en"},{translationCopyDigest:"b".repeat(64)},{informationalTerms:[]}]) {
      await expect(prisma.signatureRecord.update({where:{id:signatureId},data})).rejects.toThrow("Historical signed language evidence");
    }
    expect((await prisma.signatureRecord.findUniqueOrThrow({where:{id:signatureId}})).informationalTerms).toEqual(original.informationalTerms);
  });
  it("keeps signed-language evidence column optional for old signed records", async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'SignatureRecord' AND column_name = 'shownLanguage'
    `;
    expect(columns).toEqual([{ column_name: "shownLanguage", is_nullable: "YES" }]);
  });
});
