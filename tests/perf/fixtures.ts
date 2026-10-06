import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
export const PERF_ENABLED =
  process.env.CI === "true" &&
  process.env.BATCH_E_PERF === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
  databaseUrl.pathname === "/appliance_desk_test";

export const LARGE_ACCOUNT_PROPERTIES = 50;
export const LARGE_ACCOUNT_APPLIANCES = 200;
export const LARGE_INVOICE_COUNT = 5_000;

export async function measuredMedian<T>(
  label: string,
  fn: () => Promise<T>,
  samples = 5,
): Promise<{ value: T; ms: number; samples: number[] }> {
  if (!Number.isInteger(samples) || samples < 3) throw new Error("Performance measurements need at least three samples.");

  await fn();
  const timings: number[] = [];
  let value!: T;
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    value = await fn();
    timings.push(performance.now() - started);
  }
  const ordered = [...timings].sort((a, b) => a - b);
  const ms = ordered[Math.floor(ordered.length / 2)]!;
  console.log(
    `[batch-f-perf] ${label}: median ${ms.toFixed(1)}ms; samples ${timings.map((n) => n.toFixed(1)).join(", ")}ms`,
  );
  return { value, ms, samples: timings };
}

export function perfBaselineMs(key: string, markdown = readFileSync("docs/PERF-BASELINE.md", "utf8")): number {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error("Performance baseline key is invalid.");
  const match = markdown.match(
    new RegExp("^\\|\\s*" + key + "\\s*\\|\\s*([0-9]+(?:\\.[0-9]+)?)\\s*ms\\s*\\|", "m"),
  );
  if (!match) throw new Error(`No numeric performance baseline is recorded for "${key}".`);
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid performance baseline for "${key}".`);
  return value;
}

export function enforceRegressionGuard(
  key: string,
  measuredMs: number,
  baselineMs: number,
  overrideReason = process.env.PERF_BASELINE_OVERRIDE_REASON,
): { limitMs: number; overridden: boolean } {
  if (!Number.isFinite(measuredMs) || measuredMs < 0 || !Number.isFinite(baselineMs) || baselineMs <= 0) {
    throw new Error("Performance guard received an invalid measurement or baseline.");
  }
  const limitMs = baselineMs * 1.2;
  if (measuredMs <= limitMs) return { limitMs, overridden: false };

  const reason = overrideReason?.trim();
  if (reason) {
    console.warn(
      `[batch-f-perf] OVERRIDE ${key}: ${measuredMs.toFixed(1)}ms > ${limitMs.toFixed(1)}ms (+20%). Reason: ${reason}`,
    );
    return { limitMs, overridden: true };
  }
  throw new Error(
    `${key} regressed: ${measuredMs.toFixed(1)}ms exceeds the ${baselineMs.toFixed(1)}ms baseline by more than 20% (limit ${limitMs.toFixed(1)}ms). Set PERF_BASELINE_OVERRIDE_REASON only with a reviewed reason.`,
  );
}

export function enforceRecordedBaseline(key: string, measuredMs: number): void {
  enforceRegressionGuard(key, measuredMs, perfBaselineMs(key));
}

export type LargeAccountFixture = {
  tag: string;
  userId: string;
  customerId: string;
  applianceTypeId: string;
  cleanup: () => Promise<void>;
};

export async function createLargeAccountFixture(): Promise<LargeAccountFixture> {
  const tag = `fperf-${randomUUID().replaceAll("-", "")}`;
  const userId = `${tag}-user`;
  const customerId = `${tag}-customer`;
  const applianceTypeId = `${tag}-type`;
  const addressId = (index: number) => `${tag}-address-${index}`;
  const agreementId = (index: number) => `${tag}-agreement-${index}`;
  const lineId = (index: number) => `${tag}-line-${index}`;
  const applianceId = (index: number) => `${tag}-appliance-${index}`;

  await prisma.user.create({
    data: {
      id: userId,
      email: `${tag}@example.test`,
      name: "F capacity property manager",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  await prisma.customer.create({
    data: {
      id: customerId,
      userId,
      referralCode: `F${tag.slice(-20)}`,
      isBusiness: true,
      isPropertyManager: true,
      companyName: "F Capacity Properties",
    },
  });
  await prisma.applianceType.create({
    data: {
      id: applianceTypeId,
      name: `F Capacity Washer ${tag.slice(-8)}`,
      slug: `f-capacity-washer-${tag.slice(-12)}`,
      monthlyPriceCents: 3_500,
    },
  });
  await prisma.serviceAddress.createMany({
    data: Array.from({ length: LARGE_ACCOUNT_PROPERTIES }, (_, index) => ({
      id: addressId(index),
      customerId,
      line1: `${100 + index} Capacity St`,
      city: "Greeley",
      state: "CO",
      zip: "80631",
    })),
  });
  const activeAt = new Date("2026-01-01T12:00:00.000Z");
  await prisma.rentalAgreement.createMany({
    data: Array.from({ length: LARGE_ACCOUNT_PROPERTIES }, (_, index) => ({
      id: agreementId(index),
      customerId,
      serviceAddressId: addressId(index),
      status: "ACTIVE" as const,
      startDate: activeAt,
      billingStartedAt: activeAt,
    })),
  });
  await prisma.rentalLine.createMany({
    data: Array.from({ length: LARGE_ACCOUNT_APPLIANCES }, (_, index) => ({
      id: lineId(index),
      agreementId: agreementId(Math.floor(index / 4)),
      label: `Capacity unit ${index + 1}`,
      monthlyPriceCents: 3_500,
      listPriceCents: 3_500,
    })),
  });
  await prisma.appliance.createMany({
    data: Array.from({ length: LARGE_ACCOUNT_APPLIANCES }, (_, index) => ({
      id: applianceId(index),
      assetNumber: `F-${tag.slice(-8)}-${index.toString().padStart(3, "0")}`,
      applianceTypeId,
      status: "RENTED" as const,
    })),
  });
  await prisma.applianceAssignment.createMany({
    data: Array.from({ length: LARGE_ACCOUNT_APPLIANCES }, (_, index) => ({
      id: `${tag}-assignment-${index}`,
      rentalLineId: lineId(index),
      applianceId: applianceId(index),
    })),
  });

  return {
    tag,
    userId,
    customerId,
    applianceTypeId,
    cleanup: async () => {
      await prisma.applianceAssignment.deleteMany({ where: { id: { startsWith: `${tag}-assignment-` } } });
      await prisma.rentalLine.deleteMany({ where: { id: { startsWith: `${tag}-line-` } } });
      await prisma.rentalAgreement.deleteMany({ where: { id: { startsWith: `${tag}-agreement-` } } });
      await prisma.appliance.deleteMany({ where: { id: { startsWith: `${tag}-appliance-` } } });
      await prisma.serviceAddress.deleteMany({ where: { id: { startsWith: `${tag}-address-` } } });
      await prisma.customer.delete({ where: { id: customerId } });
      await prisma.user.delete({ where: { id: userId } });
      await prisma.applianceType.delete({ where: { id: applianceTypeId } });
    },
  };
}

export type LargeInvoiceFixture = {
  tag: string;
  customerId: string;
  cleanup: () => Promise<void>;
};

export async function createLargeInvoiceFixture(): Promise<LargeInvoiceFixture> {
  const tag = `fperf-invoice-${randomUUID().replaceAll("-", "")}`;
  const userId = `${tag}-user`;
  const customerId = `${tag}-customer`;

  await prisma.user.create({
    data: {
      id: userId,
      email: `${tag}@example.test`,
      name: "F capacity invoice customer",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  await prisma.customer.create({
    data: {
      id: customerId,
      userId,
      referralCode: `I${tag.slice(-20)}`,
    },
  });
  const createdAt = new Date("2026-01-01T12:00:00.000Z");
  await prisma.invoice.createMany({
    data: Array.from({ length: LARGE_INVOICE_COUNT }, (_, index) => ({
      id: `${tag}-row-${index}`,
      customerId,
      status: "OPEN" as const,
      amountDueCents: 6_000 + (index % 10),
      amountPaidCents: 0,
      dueDate: createdAt,
      createdAt: new Date(createdAt.getTime() + index),
    })),
  });

  return {
    tag,
    customerId,
    cleanup: async () => {
      await prisma.invoice.deleteMany({ where: { id: { startsWith: `${tag}-row-` } } });
      await prisma.customer.delete({ where: { id: customerId } });
      await prisma.user.delete({ where: { id: userId } });
    },
  };
}
