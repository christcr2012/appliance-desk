import type { Prisma } from "@prisma/client";

/** Frozen at signature: a prepaid large order remains large with no advance. */
export type SignedCancellationPolicyEvidence = {
  schemaVersion: 1;
  agreementId: string;
  orderFingerprint: string;
  signedAt: string;
  settingsUpdatedAt: string;
  machineThreshold: number;
  fullRefundHours: number;
  machines: Array<{ agreementId: string; count: number }>;
  businessCustomer: boolean;
  propertyManagerCustomer: boolean;
  largeOrder: boolean;
  reasons: Array<"MACHINE_THRESHOLD" | "BUSINESS_CUSTOMER" | "PROPERTY_MANAGER">;
};
type Machine = { agreementId: string; machineCount: number };
type Settings = { largeOrderMachineThreshold: number;
  largeOrderCancellationFullRefundHours: number; updatedAt: Date };
const validId = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= 256;
const validHash = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const integer = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
const validISO = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
  Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
function classify(count: number, threshold: number, business: boolean, manager: boolean) {
  const reasons: SignedCancellationPolicyEvidence["reasons"] = [];
  if (count >= threshold) reasons.push("MACHINE_THRESHOLD");
  if (business) reasons.push("BUSINESS_CUSTOMER");
  if (manager) reasons.push("PROPERTY_MANAGER");
  return reasons;
}

/** Requires all trusted, exact-customer frozen siblings; no user-supplied amounts. */
export function buildSignedCancellationPolicyEvidence(input: {
  agreementId: string; orderFingerprint: string; signedAt: Date;
  settings: Settings; machines: readonly Machine[];
  businessCustomer: boolean; propertyManagerCustomer: boolean;
}): SignedCancellationPolicyEvidence {
  const { settings } = input;
  if (!validId(input.agreementId) || !validHash(input.orderFingerprint) ||
      !(input.signedAt instanceof Date) || !Number.isFinite(input.signedAt.getTime()) ||
      !(settings.updatedAt instanceof Date) || !Number.isFinite(settings.updatedAt.getTime()) ||
      !integer(settings.largeOrderMachineThreshold, 1, 1000) ||
      !integer(settings.largeOrderCancellationFullRefundHours, 1, 720) ||
      typeof input.businessCustomer !== "boolean" ||
      typeof input.propertyManagerCustomer !== "boolean" ||
      !input.machines.length || input.machines.length > 500)
    throw new Error("The signed cancellation policy needs a complete reviewed order.");
  const machines = input.machines.map(row => {
    if (!validId(row.agreementId) || !integer(row.machineCount, 1, 1000))
      throw new Error("Every agreement needs its original verified machine count.");
    return { agreementId: row.agreementId, count: row.machineCount };
  }).sort((a,b) => a.agreementId.localeCompare(b.agreementId));
  if (!machines.some(row => row.agreementId === input.agreementId) ||
      new Set(machines.map(row => row.agreementId)).size !== machines.length)
    throw new Error("Cancellation policy contains duplicate or foreign agreements.");
  const count = machines.reduce((sum,row) => sum + row.count, 0);
  if (!integer(count, 1, 500_000)) throw new Error("Unsupported signed machine count.");
  const reasons = classify(count, settings.largeOrderMachineThreshold,
    input.businessCustomer, input.propertyManagerCustomer);
  return {
    schemaVersion: 1, agreementId: input.agreementId,
    orderFingerprint: input.orderFingerprint,
    signedAt: input.signedAt.toISOString(),
    settingsUpdatedAt: settings.updatedAt.toISOString(),
    machineThreshold: settings.largeOrderMachineThreshold,
    fullRefundHours: settings.largeOrderCancellationFullRefundHours,
    machines, businessCustomer: input.businessCustomer,
    propertyManagerCustomer: input.propertyManagerCustomer,
    largeOrder: reasons.length > 0, reasons,
  };
}

/** Corrupt non-null history requires finance review; no current-policy fallback. */
export function readSignedCancellationPolicyEvidence(
  raw: unknown,
  expected: { agreementId: string; orderFingerprint: string; signedAt: Date },
): SignedCancellationPolicyEvidence | null {
  if (raw === null || raw === undefined) return null; // Historical V1 without policy.
  const error = () => new Error("Signed cancellation evidence disagrees with the original order; finance review is required.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw error();
  const row = raw as Record<string, unknown>;
  if (row.schemaVersion !== 1 || row.agreementId !== expected.agreementId ||
      row.orderFingerprint !== expected.orderFingerprint ||
      !validISO(row.signedAt) || row.signedAt !== expected.signedAt.toISOString() ||
      !validISO(row.settingsUpdatedAt) ||
      !integer(row.machineThreshold, 1, 1000) ||
      !integer(row.fullRefundHours, 1, 720) ||
      typeof row.businessCustomer !== "boolean" ||
      typeof row.propertyManagerCustomer !== "boolean" ||
      typeof row.largeOrder !== "boolean" ||
      !Array.isArray(row.machines) || !row.machines.length || row.machines.length > 500 ||
      !Array.isArray(row.reasons)) throw error();
  const machines: Array<{ agreementId: string; count: number }> = [];
  for (const item of row.machines) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw error();
    const fact = item as Record<string, unknown>;
    if (!validId(fact.agreementId) || !integer(fact.count, 1, 1000)) throw error();
    machines.push({ agreementId: fact.agreementId, count: fact.count });
  }
  if (!machines.some(item => item.agreementId === expected.agreementId) ||
      new Set(machines.map(item => item.agreementId)).size !== machines.length ||
      machines.some((item,i) => i>0 && machines[i-1].agreementId >= item.agreementId))
    throw error();
  const count = machines.reduce((sum,item) => sum + item.count,0);
  if (!integer(count,1,500_000)) throw error();
  const reasons = classify(count, row.machineThreshold as number,
    row.businessCustomer as boolean, row.propertyManagerCustomer as boolean);
  if (row.largeOrder !== (reasons.length > 0) ||
      JSON.stringify(row.reasons) !== JSON.stringify(reasons)) throw error();
  return row as unknown as SignedCancellationPolicyEvidence;
}

/** Called inside the signing transaction after verifying the full frozen order. */
export async function getCancellationPolicyAtSigningInTx(
  tx: Prisma.TransactionClient,
  input: { agreementId: string; customerId: string; orderFingerprint: string;
    signedAt: Date; verifiedAgreementIds: readonly string[] },
): Promise<SignedCancellationPolicyEvidence> {
  const ids = [...new Set(input.verifiedAgreementIds)].sort();
  if (!ids.length || ids.length > 500 || ids.length !== input.verifiedAgreementIds.length ||
      !ids.includes(input.agreementId))
    throw new Error("A complete order is required to freeze cancellation rules.");
  // Shared-row locks serialize the policy read with owner policy/customer edits.
  await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${input.customerId} FOR SHARE`;
  const [settings,customer,agreements,charges] = await Promise.all([
    tx.businessSettings.findUnique({where:{id:"singleton"},select:{
      largeOrderMachineThreshold:true,largeOrderCancellationFullRefundHours:true,updatedAt:true }}),
    tx.customer.findUnique({where:{id:input.customerId},select:{isBusiness:true,isPropertyManager:true}}),
    tx.rentalAgreement.findMany({where:{id:{in:ids},customerId:input.customerId},
      select:{id:true},orderBy:{id:"asc"}}),
    tx.agreementSigningCharge.findMany({where:{agreementId:{in:ids},
      frozenOrderFingerprint:input.orderFingerprint,frozenAt:{not:null}},
      select:{agreementId:true,machineCount:true},orderBy:{agreementId:"asc"}}),
  ]);
  if (!settings || !customer || agreements.length !== ids.length || charges.length !== ids.length ||
      agreements.some((row,i)=>row.id!==ids[i]) ||
      charges.some((row,i)=>row.agreementId!==ids[i]))
    throw new Error("Signed cancellation classification requires matching customer-owned frozen charges.");
  return buildSignedCancellationPolicyEvidence({
    agreementId:input.agreementId,orderFingerprint:input.orderFingerprint,
    signedAt:input.signedAt,settings,machines:charges,
    businessCustomer:customer.isBusiness,propertyManagerCustomer:customer.isPropertyManager,
  });
}
