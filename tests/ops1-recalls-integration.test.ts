import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { CPSC_SAMPLE } from "./fixtures/ops1-cpsc-sample";
import { runRecallWatch, requestFleetRecheck } from "@/domains/recalls/watch";
import {
  assertNotRecallHeld, assertNotRecalledForSale, confirmRecallMatch, decideSafetyIncident, markRecallNotOurs, markRecallRemedied,
  markSafetyIncident,
} from "@/domains/recalls/hold";
import { listRecallAttention } from "@/domains/exceptions/recall-attention";
import { addRentalLine } from "@/domains/agreements";
import { assertStatusChangeKeepsCustody } from "@/domains/inventory/custody";
import { markCleaningDone } from "@/domains/inventory/cleaning";
import { getSwapCandidates } from "@/domains/inventory/guided-actions";
import { createShopSale } from "@/domains/sales";
import { setRetiredPlan, addSalvagedParts } from "@/domains/inventory/retired-plans";

// OPS-1 on real Postgres: the nightly check only ever records POSSIBLE matches; confirming one is Chris's decision and
// puts the machine on hold; a hold stops every path that would rent, reserve, swap, sell or list it for parts.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("product recalls (real Postgres, fake government list)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const ownerId = `ops1-owner-${tag}`;
  const staffId = `ops1-staff-${tag}`;
  const customerUserId = `ops1-cust-${tag}`;
  const typeId = `ops1-type-${tag}`;
  const otherTypeId = `ops1-other-type-${tag}`;
  let customerId = "";
  let addressId = "";
  const applianceIds: string[] = [];
  const maker = `Testmaker`;
  const mk = async (data: { id: string; status?: "AVAILABLE" | "RETIRED" | "CLEANING" | "RESERVED" | "RENTED"; manufacturer?: string | null; model?: string | null; typeId?: string }) => {
    applianceIds.push(data.id);
    return prisma.appliance.create({
      data: {
        id: data.id, assetNumber: `OPS1-${tag}-${applianceIds.length}`, applianceTypeId: data.typeId ?? typeId,
        status: data.status ?? "AVAILABLE", manufacturer: data.manufacturer === undefined ? maker : data.manufacturer, model: data.model === undefined ? "TM-RR10" : data.model,
      },
    });
  };
  const idOf = (name: string) => `ops1-${name}-${tag}`;
  // The only appliances in the fleet are this file's: other test files share the database, so the fake list is filtered to ours.
  const answer = (url: string) => {
    const term = new URL(url).searchParams.get("ProductName");
    return Promise.resolve(term === "refrigerator" ? CPSC_SAMPLE : []);
  };

  beforeAll(async () => {
    // This file owns the one-row check bookmark: start from "never checked".
    await prisma.recallWatchState.deleteMany();
    for (const [id, role] of [[ownerId, "OWNER"], [staffId, "STAFF"], [customerUserId, "CUSTOMER"]] as const) {
      await prisma.user.create({ data: { id, email: `${id}@example.test`, name: `OPS1 ${role}`, role, emailVerified: true } });
    }
    const customer = await prisma.customer.create({ data: { userId: customerUserId, referralCode: `OPS1${tag}` } });
    customerId = customer.id;
    addressId = (await prisma.serviceAddress.create({ data: { customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } })).id;
    await prisma.applianceType.create({ data: { id: typeId, name: "Refrigerator", slug: `ops1-fridge-${tag}`, recallProductTerms: ["refrigerator"] } });
    await prisma.applianceType.create({ data: { id: otherTypeId, name: "Washer", slug: `ops1-washer-${tag}`, recallProductTerms: ["washer"] } });
    await mk({ id: idOf("fridge") });                                   // maker + model in the notice
    await mk({ id: idOf("fridge-nomodel"), model: null });              // maker only
    await mk({ id: idOf("fridge-otherModel"), model: "TM-ZZ99" });      // maker, different model
    await mk({ id: idOf("washer"), manufacturer: "Washwell", model: "WW-4400", typeId: otherTypeId });
  });

  afterAll(async () => {
    await prisma.recallWatchState.deleteMany();
    await prisma.staffTask.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.safetyIncident.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.recallMatch.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreement: { customerId } } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId } });
    await prisma.retiredAppliancePlan.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: [ownerId, staffId] } }, { entityId: { in: applianceIds } }] } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: [typeId, otherTypeId] } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, customerUserId] } } });
  });

  const mine = () => prisma.recallMatch.findMany({ where: { applianceId: { in: applianceIds } }, orderBy: [{ recallId: "asc" }, { applianceId: "asc" }] });

  it("the nightly check records POSSIBLE matches only, once, and changes nothing else", async () => {
    const before = await prisma.appliance.findMany({ where: { id: { in: applianceIds } }, select: { id: true, status: true, recallHold: true } });
    const counts = await runRecallWatch(new Date("2026-10-26T11:30:00Z"), answer);
    expect(counts.failedSearches).toBe(0);
    const rows = await mine();
    // Fridge (maker + model) and the no-model fridge match; the different-model fridge and the washer do not.
    expect(rows.map((r) => `${r.recallId}:${r.applianceId}`).sort()).toEqual([
      `90001:${idOf("fridge")}`, `90001:${idOf("fridge-nomodel")}`,
    ].sort());
    expect(rows.every((r) => r.state === "POSSIBLE" && r.decidedAt === null)).toBe(true);
    expect(rows[0]!.url).toContain("cpsc.gov");
    expect(await prisma.appliance.findMany({ where: { id: { in: applianceIds } }, select: { id: true, status: true, recallHold: true } })).toEqual(before);
    expect(await prisma.staffTask.count({ where: { applianceId: { in: applianceIds } } })).toBe(0);
  });

  it("running again changes nothing and never undoes a decision", async () => {
    const first = (await mine()).map((r) => r.id);
    await runRecallWatch(new Date("2026-10-27T11:30:00Z"), answer);
    expect((await mine()).map((r) => r.id)).toEqual(first);
  });

  it("a failed search surfaces as a failed run and keeps the old date so the next night asks again", async () => {
    const before = (await prisma.recallWatchState.findUniqueOrThrow({ where: { id: "singleton" } })).lastSuccessAt;
    await expect(runRecallWatch(new Date("2026-10-28T11:30:00Z"), () => Promise.reject(new Error("The site is down")))).rejects.toThrow(/failed/);
    const after = await prisma.recallWatchState.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(after.lastSuccessAt).toEqual(before);
    expect(after.lastError).toContain("The site is down");
  });

  it("Check my whole fleet asks for the fifteen-year look-back on the next run", async () => {
    await requestFleetRecheck(new Date("2026-10-29T10:00:00Z"));
    const urls: string[] = [];
    await runRecallWatch(new Date("2026-10-29T11:30:00Z"), (url) => { urls.push(url); return answer(url); });
    expect(urls.some((u) => new URL(u).searchParams.has("RecallDateStart") && new URL(u).searchParams.get("Manufacturer") === maker)).toBe(true);
    const state = await prisma.recallWatchState.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(state.fullFleetCheckedAt).not.toBeNull();
    expect(state.lastError).toBeNull();
  });

  it("one To do item per recall, not per appliance", async () => {
    const items = (await listRecallAttention(new Date())).filter((i) => i.href.endsWith("/90001"));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: "RECALL_POSSIBLE", severity: "high" });
    expect(items[0]!.title).toMatch(/^Possible recall: .* — \d+ of your appliances$/);
  });

  it("only an owner or admin can confirm, and confirming is the only thing that puts a machine on hold", async () => {
    const match = (await mine()).find((r) => r.applianceId === idOf("fridge"))!;
    await expect(confirmRecallMatch(staffId, match.id)).rejects.toThrow(/no longer has access/);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: idOf("fridge") } })).recallHold).toBe(false);
  });

  it("confirming holds the machine, asks Chris to contact current renters once, and sends nothing", async () => {
    // A customer currently renting the machine on an active agreement.
    const agreement = await prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: addressId, status: "ACTIVE" } });
    const line = await prisma.rentalLine.create({ data: { agreementId: agreement.id, label: "Fridge", monthlyPriceCents: 4000, listPriceCents: 4000 } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: idOf("fridge") } });
    const messagesBefore = await prisma.messageDelivery.count();
    const match = (await mine()).find((r) => r.applianceId === idOf("fridge"))!;

    const first = await confirmRecallMatch(ownerId, match.id);
    const second = await confirmRecallMatch(ownerId, match.id);
    expect(first.tasksCreated).toBe(1);
    expect(second.tasksCreated).toBe(0);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: idOf("fridge") } })).recallHold).toBe(true);
    const tasks = await prisma.staffTask.findMany({ where: { applianceId: idOf("fridge") } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ priority: "HIGH", customerId, completedAt: null });
    expect(tasks[0]!.note).toMatch(/^Contact .*: swap or repair OPS1-/);
    expect(await prisma.messageDelivery.count()).toBe(messagesBefore);
    expect(await prisma.auditLog.count({ where: { action: "recall.confirmed", entityId: idOf("fridge") } })).toBe(1);
    // The machine next to it, still only "possible", is not held.
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: idOf("fridge-nomodel") } })).recallHold).toBe(false);
  });

  it("a hold blocks assigning to an agreement, every status that makes it rentable, swaps, and cleaning-done", async () => {
    const held = idOf("fridge");
    const agreement = await prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: addressId, status: "DRAFT" } });
    await expect(addRentalLine(ownerId, agreement.id, { label: "x", listPriceCents: 4000, applianceIds: [held] })).rejects.toThrow(/recall hold/);
    await prisma.$transaction(async (tx) => {
      for (const next of ["AVAILABLE", "RESERVED", "RENTED"] as const) {
        await expect(assertStatusChangeKeepsCustody(tx, held, next)).rejects.toThrow(/recall hold/);
      }
      await expect(assertNotRecallHeld(tx, held, "swapped in")).rejects.toThrow(/can't be swapped in/);
    });
    await prisma.appliance.update({ where: { id: held }, data: { status: "CLEANING" } });
    await expect(markCleaningDone(ownerId, held)).rejects.toThrow(/recall hold/);
    await prisma.appliance.update({ where: { id: held }, data: { status: "AVAILABLE" } });
    const candidates = await getSwapCandidates(idOf("fridge-nomodel"));
    expect(candidates.map((c) => c.id)).not.toContain(held);
    // The unheld machine of the same type is still rentable.
    await expect(addRentalLine(ownerId, agreement.id, { label: "ok", listPriceCents: 4000, applianceIds: [idOf("fridge-nomodel")] })).resolves.toBeTruthy();
  });

  it("a confirmed recall refuses to sell or list for parts the held machine AND any machine of the same maker and model", async () => {
    const sameModel = idOf("sameModel");
    await mk({ id: sameModel, status: "RETIRED" });
    await mk({ id: idOf("differentModel"), status: "RETIRED", model: "TM-ZZ99" });
    await prisma.$transaction(async (tx) => {
      await expect(assertNotRecalledForSale(tx, idOf("fridge"), "sold")).rejects.toThrow(/recall hold/);
      await expect(assertNotRecalledForSale(tx, sameModel, "sold")).rejects.toThrow(/illegal to sell a recalled product/);
      await expect(assertNotRecalledForSale(tx, sameModel, "listed for parts")).rejects.toThrow(/listed for parts/);
      await expect(assertNotRecalledForSale(tx, idOf("differentModel"), "sold")).resolves.toBeUndefined();
    });
    // The real paths call the same check before anything is written.
    await setRetiredPlan(ownerId, sameModel, { choice: "SELL" });
    await expect(createShopSale(ownerId, { operationKey: `ops1-sale-${tag}`, customerId: null, walkInName: "Pat", location: "PICKUP", items: [], usedAppliances: [{ applianceId: sameModel, unitPriceCents: 20000 }] }))
      .rejects.toThrow(/recall/i);
    expect(await prisma.invoiceLineItem.count({ where: { applianceId: sameModel } })).toBe(0);
    await setRetiredPlan(ownerId, sameModel, { choice: "STRIP" });
    await expect(addSalvagedParts(ownerId, sameModel, `ops1-parts-${tag}-a`, [{ modelNumber: "M1", partNumber: "P1", partName: "Motor", quantity: 1 } as never]))
      .rejects.toThrow(/recall/i);
  });

  it("not ours needs a reason; the fix being done lifts the hold unless another recall still covers the machine", async () => {
    const match = (await mine()).find((r) => r.applianceId === idOf("fridge"))!;
    await expect(markRecallNotOurs(ownerId, match.id, "  ")).rejects.toThrow(/why/);
    await expect(markRecallRemedied(ownerId, match.id, "")).rejects.toThrow(/what was done/i);
    // A second confirmed recall on the same machine.
    const second = await prisma.recallMatch.create({
      data: { recallId: "90002", recallNumber: "99-002", title: "Another recall", url: "https://www.cpsc.gov/Recalls", applianceId: idOf("fridge"), matchReason: "test", state: "CONFIRMED", decidedAt: new Date(), decidedByUserId: ownerId },
    });
    await markRecallRemedied(ownerId, match.id, "Repair kit installed");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: idOf("fridge") } })).recallHold).toBe(true); // another confirmed recall still covers it
    await markRecallNotOurs(ownerId, second.id, "Different serial range");
    const after = await prisma.appliance.findUniqueOrThrow({ where: { id: idOf("fridge") } });
    expect(after.recallHold).toBe(false);
    expect((await prisma.recallMatch.findUniqueOrThrow({ where: { id: match.id } })).state).toBe("REMEDIED");
  });

  it("an injury or safety incident is recorded once and waits on Chris's decision (owner or admin only)", async () => {
    const request = await prisma.maintenanceRequest.create({ data: { customerId, applianceId: idOf("fridge-nomodel"), problem: "Smells like smoke" } });
    const first = await markSafetyIncident(staffId, { maintenanceRequestId: request.id, description: "Smoke came from the back panel" });
    const again = await markSafetyIncident(staffId, { maintenanceRequestId: request.id, description: "Same thing" });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    const incident = await prisma.safetyIncident.findUniqueOrThrow({ where: { id: first.id } });
    expect(incident).toMatchObject({ applianceId: idOf("fridge-nomodel"), decision: "PENDING" });

    const items = (await listRecallAttention(new Date())).filter((i) => i.category === "SAFETY_INCIDENT" && i.href.endsWith(first.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe("high");
    expect(items[0]!.title).toMatch(/within 24 hours/);
    expect(items[0]!.dueOn!.getTime() - incident.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);

    await expect(decideSafetyIncident(staffId, first.id, "REPORTED", "Done")).rejects.toThrow(/no longer has access/);
    await expect(decideSafetyIncident(ownerId, first.id, "REPORTED", " ")).rejects.toThrow(/note/);
    await decideSafetyIncident(ownerId, first.id, "NOT_REPORTED", "Attorney says renting is not covered; no injury.");
    await decideSafetyIncident(ownerId, first.id, "REPORTED", "ignored: already decided");
    expect((await prisma.safetyIncident.findUniqueOrThrow({ where: { id: first.id } })).decision).toBe("NOT_REPORTED");
    expect((await listRecallAttention(new Date())).filter((i) => i.href.endsWith(first.id))).toHaveLength(0);
    await prisma.maintenanceRequest.delete({ where: { id: request.id } }).catch(() => undefined);
  });
});
