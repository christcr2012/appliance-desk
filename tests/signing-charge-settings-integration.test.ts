import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveSigningChargeSettingsAction } from "@/app/desk/settings/signing-charge-actions";

const context = vi.hoisted(() => ({ actorId: "" }));
vi.mock("@/lib/session", () => ({ requireRole: vi.fn(async () => ({ user: { id: context.actorId } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("W-22A signing settings on disposable Postgres", () => {
  const marker = randomUUID().replaceAll("-", "");
  let old: Awaited<ReturnType<typeof prisma.businessSettings.findUniqueOrThrow>>;
  let owner: string; let staff: string;
  beforeAll(async () => {
    old = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const ownerRow = await prisma.user.create({ data: { email: `${marker}@owner.test`, role: "OWNER", passwordHash: "test-only" } });
    const staffRow = await prisma.user.create({ data: { email: `${marker}@staff.test`, role: "STAFF", passwordHash: "test-only" } });
    owner = ownerRow.id; staff = staffRow.id;
  });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
      administrativeSetupFeeCents: old.administrativeSetupFeeCents,
      largeOrderMachineThreshold: old.largeOrderMachineThreshold,
      largeOrderCancellationFullRefundHours: old.largeOrderCancellationFullRefundHours,
      businessRequiresDownPayment: old.businessRequiresDownPayment,
      setupFeeTaxTreatment: old.setupFeeTaxTreatment,
      setupFeeTaxDecisionNote: old.setupFeeTaxDecisionNote,
    } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner, staff] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff] } } });
  });
  const form = (updatedAt: Date) => {
    const data = new FormData();
    data.set("updatedAt", updatedAt.toISOString());
    data.set("setupFeeDollars", "45.00");
    data.set("largeOrderMachineThreshold", "5");
    data.set("largeOrderCancellationFullRefundHours", "72");
    data.set("businessRequiresDownPayment", "on");
    data.set("setupFeeTaxTreatment", "UNDECIDED");
    return data;
  };
  it("denies staff via database reauthorization", async () => {
    context.actorId = staff;
    const result = await saveSigningChargeSettingsAction({ error: "", success: "" }, form((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).updatedAt));
    expect(result.error).toBeTruthy();
  });
  it("saves once with audit and rejects stale edits", async () => {
    context.actorId = owner;
    const current = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const result = await saveSigningChargeSettingsAction({ error: "", success: "" }, form(current.updatedAt));
    expect(result.success).toMatch(/saved/i);
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(settings.administrativeSetupFeeCents).toBe(4500);
    expect(await prisma.auditLog.count({ where: { userId: owner, action: "settings.signing_charges.update" } })).toBe(1);
    const again = await saveSigningChargeSettingsAction({ error: "", success: "" }, form(current.updatedAt));
    expect(again.error).toMatch(/changed|refresh/i);
  });
  it("does not accept an unsupported tax decision and can restore defaults", async () => {
    context.actorId = owner;
    let current = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const invalid = form(current.updatedAt);
    invalid.set("setupFeeTaxTreatment", "TAXABLE");
    expect((await saveSigningChargeSettingsAction({ error: "", success: "" }, invalid)).error).toMatch(/tax adviser/i);
    current = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const reset = form(current.updatedAt);
    reset.set("operation", "restore");
    expect((await saveSigningChargeSettingsAction({ error: "", success: "" }, reset)).success).toMatch(/saved/i);
    const restored = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(restored.setupFeeTaxTreatment).toBe("UNDECIDED");
  });
});
