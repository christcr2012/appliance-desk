import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { completeRetiredPlan, completeRetiredPlans, setRetiredPlan } from "@/domains/inventory/retired-plans";
import { keepReceiptOnRecord, loadRefrigerantPanel, loadStatementFacts, saveRefrigerantRecord, saveRefrigerantTypes } from "@/domains/refrigerant/actions";
import type { RefrigerantInput } from "@/domains/refrigerant/rules";
import { businessDateKey } from "@/lib/business-date";

// OPS-2 on real Postgres.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";
const today = () => businessDateKey(new Date());

describe.skipIf(!enabled)("refrigerant records (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 8);
  const adminId = `ops2-admin-${tag}`;
  const staffId = `ops2-staff-${tag}`;
  let ownerId = "";
  let fridgeType = "";
  let washerType = "";
  const created: string[] = [];
  const good: RefrigerantInput = {
    refrigerantType: "R-134a", outcome: "RECOVERED", recoveredByName: "Cool Repair LLC", recoveredByAddress: "5 Main St, Greeley, CO",
    recoveredOnKey: today(), certify: true, certificationNumber: "EPA-608-1",
  };

  async function retired(typeId: string, choice: "SCRAP" | "DISPOSE" | "SELL" | "STRIP") {
    const id = `ops2-${tag}-${created.length}`;
    await prisma.appliance.create({ data: { id, assetNumber: `OPS2-${tag}-${created.length}`, applianceTypeId: typeId, status: "RETIRED", manufacturer: "Frigidaire", model: "FFTR" } });
    created.push(id);
    await setRetiredPlan(ownerId, id, { choice });
    return id;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.create({ data: { id: adminId, email: `${adminId}@example.test`, role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: staffId, email: `${staffId}@example.test`, role: "STAFF", emailVerified: true } });
    fridgeType = (await prisma.applianceType.create({ data: { name: `Refrigerator ops2 ${tag}`, slug: `refrigerator-ops2-${tag}`, hasRefrigerant: true } })).id;
    washerType = (await prisma.applianceType.create({ data: { name: `Washer ops2 ${tag}`, slug: `washer-ops2-${tag}` } })).id;
  });

  afterAll(async () => {
    const receipts = await prisma.refrigerantRecord.findMany({ where: { applianceId: { in: created }, receiptRecordId: { not: null } }, select: { receiptRecordId: true } });
    await prisma.refrigerantRecord.deleteMany({ where: { applianceId: { in: created } } });
    await prisma.businessPaperwork.deleteMany({ where: { id: { in: receipts.map((r) => r.receiptRecordId!) } } });
    await prisma.retiredAppliancePlan.deleteMany({ where: { applianceId: { in: created } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...created, fridgeType, washerType] } } });
    await prisma.appliance.deleteMany({ where: { id: { in: created } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: [fridgeType, washerType] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, staffId] } } });
  });

  it("starts with refrigerators marked as having refrigerant and washers not", async () => {
    const seeded = await prisma.applianceType.findMany({ where: { OR: [{ slug: { contains: "refrigerator" } }, { slug: { contains: "washer" } }] }, select: { slug: true, hasRefrigerant: true } });
    for (const t of seeded.filter((x) => x.slug.includes("ops2"))) expect(t.hasRefrigerant).toBe(t.slug.includes("refrigerator"));
  });

  it("will not mark a scrapped refrigerator done until the signed statement is on file", async () => {
    const id = await retired(fridgeType, "SCRAP");
    await expect(completeRetiredPlan(adminId, id, { doneOnKey: today() })).rejects.toThrow(/signed statement that the refrigerant was removed/);
    await saveRefrigerantRecord(adminId, id, good);
    await completeRetiredPlan(adminId, id, { doneOnKey: today() });
    expect((await prisma.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId: id } })).doneOn).not.toBeNull();
    // Once done the record is locked.
    await expect(saveRefrigerantRecord(adminId, id, good)).rejects.toThrow(/already marked done/);
  });

  it("keeps a signed statement exactly as signed, even if the appliance or signer is edited afterwards", async () => {
    const id = await retired(fridgeType, "SCRAP");
    await saveRefrigerantRecord(adminId, id, good);
    const before = await loadStatementFacts(id);
    await prisma.appliance.update({ where: { id }, data: { manufacturer: "Changed Later", model: "ZZZ" } });
    await prisma.user.update({ where: { id: adminId }, data: { name: "Renamed Person" } });
    expect(await loadStatementFacts(id)).toEqual(before);
    expect(before?.applianceDescription).toContain("Frigidaire");
  });

  it("lets Chris choose 'decide later' after a record is saved, and keeps the signed record", async () => {
    const id = await retired(fridgeType, "SCRAP");
    await saveRefrigerantRecord(adminId, id, good);
    await setRetiredPlan(ownerId, id, { choice: null });
    expect(await prisma.retiredAppliancePlan.findUnique({ where: { applianceId: id } })).toBeNull();
    expect(await prisma.refrigerantRecord.findUnique({ where: { applianceId: id } })).not.toBeNull();
    await setRetiredPlan(ownerId, id, { choice: "DISPOSE" }); // choosing again finds the record still on file
    await completeRetiredPlan(adminId, id, { doneOnKey: today() });
  });

  it("applies the same gate to throw-away, strip-then-discard and the bulk 'mark done' path, naming the appliance", async () => {
    const dispose = await retired(fridgeType, "DISPOSE");
    await expect(completeRetiredPlan(adminId, dispose, { doneOnKey: today() })).rejects.toThrow(/refrigerant/);
    const strip = await retired(fridgeType, "STRIP");
    await expect(completeRetiredPlan(adminId, strip, { doneOnKey: today(), remainder: "SCRAPPED" })).rejects.toThrow(/refrigerant/);
    await expect(completeRetiredPlans(adminId, [dispose], today())).rejects.toThrow(new RegExp(`OPS2-${tag}`));
    await saveRefrigerantRecord(adminId, dispose, { ...good, outcome: "LEAKED_BEFORE", recoveredByAddress: "" });
    await completeRetiredPlans(adminId, [dispose], today());
    expect((await prisma.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId: dispose } })).doneOn).not.toBeNull();
  });

  it("does not ask for a statement for washers, or for a fridge being sold", async () => {
    const washer = await retired(washerType, "SCRAP");
    await completeRetiredPlan(adminId, washer, { doneOnKey: today() });
    const sold = await retired(fridgeType, "SELL");
    await expect(saveRefrigerantRecord(adminId, sold, good)).rejects.toThrow(/only needed when/);
    await expect(saveRefrigerantRecord(adminId, washer, good)).rejects.toThrow();
  });

  it("refuses staff, missing signature and future dates, and builds the statement from the saved record", async () => {
    const id = await retired(fridgeType, "SCRAP");
    await expect(saveRefrigerantRecord(staffId, id, good)).rejects.toThrow();
    await expect(saveRefrigerantRecord(adminId, id, { ...good, certify: false })).rejects.toThrow(/sign/);
    await expect(saveRefrigerantRecord(adminId, id, { ...good, recoveredOnKey: "2999-01-01" })).rejects.toThrow(/future/);
    await saveRefrigerantRecord(adminId, id, good);
    const facts = await loadStatementFacts(id);
    expect(facts).toMatchObject({ refrigerantType: "R-134a", outcome: "RECOVERED", recoveredByName: "Cool Repair LLC", assetNumber: `OPS2-${tag}-${created.indexOf(id)}` });
    const panel = await loadRefrigerantPanel(id, new Date(), "OWNER");
    expect(panel?.years).toBe(6);
    expect(panel?.keepUntil && panel.keepUntil.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 6);
  });

  it("lets only the owner change which kinds of appliance have refrigerant", async () => {
    await expect(saveRefrigerantTypes(adminId, [washerType])).rejects.toThrow();
    const before = await prisma.applianceType.findMany({ where: { hasRefrigerant: true }, select: { id: true } });
    await saveRefrigerantTypes(ownerId, [...before.map((t) => t.id), washerType]);
    expect((await prisma.applianceType.findUniqueOrThrow({ where: { id: washerType } })).hasRefrigerant).toBe(true);
    await saveRefrigerantTypes(ownerId, before.map((t) => t.id));
    expect((await prisma.applianceType.findUniqueOrThrow({ where: { id: washerType } })).hasRefrigerant).toBe(false);
  });
  it("keeps the recycler's receipt on one business record: owner only, after signing, once", async () => {
    const id = await retired(fridgeType, "SCRAP");
    await expect(keepReceiptOnRecord(ownerId, id)).rejects.toThrow(/Sign the refrigerant record first/);
    await saveRefrigerantRecord(adminId, id, { ...good, recyclerName: "Front Range Metals", receiptReference: "RC-77" });
    await expect(keepReceiptOnRecord(adminId, id)).rejects.toThrow();
    await expect(keepReceiptOnRecord(staffId, id)).rejects.toThrow();
    const both = await Promise.all([keepReceiptOnRecord(ownerId, id), keepReceiptOnRecord(ownerId, id)]);
    expect(both[0].recordId).toBe(both[1].recordId);
    expect(both.filter((r) => r.created)).toHaveLength(1);
    const record = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id: both[0].recordId } });
    expect(record.kind).toBe("DOCUMENT");
    expect(record.agency).toBe("Front Range Metals");
    expect(record.referenceNumber).toBe("RC-77");
    expect(record.notes).toMatch(/Keep until \d{4}-\d{2}-\d{2}/);
    expect(await prisma.auditLog.count({ where: { action: "appliance.refrigerant_receipt_record_created", entityId: id } })).toBe(1);
    const panel = await loadRefrigerantPanel(id, new Date(), "OWNER");
    expect(panel?.receiptRecord).toEqual({ id: record.id, fileCount: 0 });
    // An admin sees it only while the vault lets admins see documents; staff never do.
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { paperworkAdminKinds: true } });
    try {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { paperworkAdminKinds: ["DOCUMENT"] } });
      expect((await loadRefrigerantPanel(id, new Date(), "ADMIN"))?.receiptRecord?.id).toBe(record.id);
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { paperworkAdminKinds: ["LICENSE"] } });
      expect((await loadRefrigerantPanel(id, new Date(), "ADMIN"))?.receiptRecord).toBeNull();
      expect((await loadRefrigerantPanel(id, new Date(), "STAFF"))?.receiptRecord).toBeNull();
    } finally {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { paperworkAdminKinds: settings.paperworkAdminKinds } });
    }
    // Re-saving the signed record keeps the receipt link.
    await saveRefrigerantRecord(adminId, id, { ...good, recyclerName: "Front Range Metals", receiptReference: "RC-78" });
    expect((await prisma.refrigerantRecord.findUniqueOrThrow({ where: { applianceId: id } })).receiptRecordId).toBe(record.id);
  });
});
