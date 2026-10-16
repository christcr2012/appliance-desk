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
  it("keeps signed-language evidence column optional for old signed records", async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'SignatureRecord' AND column_name = 'shownLanguage'
    `;
    expect(columns).toEqual([{ column_name: "shownLanguage", is_nullable: "YES" }]);
  });
});
