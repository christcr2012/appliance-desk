import { createHash, randomUUID } from "node:crypto";
import { get, put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getPrivatePhotoStore } from "@/lib/photo-storage";

const MAX_STATEMENT_BYTES = 4 * 1024 * 1024;
const PDF = "%PDF-";
const HASH = /^[a-f0-9]{64}$/;
const PRIVATE_KEY = /^telecom-statements\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.pdf$/;

export interface PrivateTelecomStatementStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array | null>;
}
export const productionStatementStore: PrivateTelecomStatementStore = {
  async put(key, bytes) {
    const store = getPrivatePhotoStore();
    if (!store) throw new Error("Private storage is not configured.");
    await put(key, Buffer.from(bytes), {
      token: store.token, access: "private", contentType: "application/pdf",
      addRandomSuffix: false, allowOverwrite: false,
      abortSignal: AbortSignal.timeout(15000),
    });
  },
  async read(key) {
    const store = getPrivatePhotoStore();
    if (!store) throw new Error("Private storage is not configured.");
    const item = await get(key, { access: "private", token: store.token, useCache: false });
    if (!item?.stream) return null;
    const reader = item.stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_STATEMENT_BYTES) {
        await reader.cancel();
        throw new Error("Private statement exceeds maximum size.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  },
};
function asDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid statement date.");
  const parsed = new Date(value + "T00:00:00Z");
  if (Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid statement date.");
  }
  return parsed;
}
function safePdf(data: Uint8Array): void {
  if (data.byteLength < 30 || data.byteLength > MAX_STATEMENT_BYTES ||
      Buffer.from(data.subarray(0, 5)).toString("ascii") !== PDF ||
      !Buffer.from(data.subarray(Math.max(0, data.byteLength - 4096))).toString("latin1")
        .includes("%%EOF")) {
    throw new Error("Statement must be a valid PDF up to 4 MB.");
  }
}
type StatementInput = {
  accountId: string; actorUserId: string; externalId: string;
  periodStart: string; periodEnd: string; issueDate: string;
  invoiceTotalCents: number; vendorTaxCents?: number | null;
  currency: string; bytes: Uint8Array;
};
export async function uploadTelecomStatement(
  input: StatementInput, store: PrivateTelecomStatementStore = productionStatementStore,
): Promise<{id:string;state:"DRAFT"}> {
  const {accountId,actorUserId,externalId,bytes}=input;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(accountId) ||
      !/^[A-Za-z0-9 ._/#-]{1,100}$/.test(externalId) ||
      !/^[A-Z]{3}$/.test(input.currency) || !Number.isSafeInteger(input.invoiceTotalCents) ||
      !Number.isInteger(input.vendorTaxCents ?? 0) ||
      Math.abs(input.invoiceTotalCents)>1_000_000_000) throw new Error("Invalid statement details.");
  const periodStart=asDay(input.periodStart), periodEnd=asDay(input.periodEnd);
  const issueDate=asDay(input.issueDate);
  if (periodEnd<periodStart || +periodEnd-+periodStart>370*86400_000) {
    throw new Error("Invalid statement period.");
  }
  safePdf(bytes);
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx,actorUserId,["OWNER"]);
    await tx.telecomAccount.findUniqueOrThrow({where:{id:accountId},select:{id:true}});
  });
  // The revision number is assigned under an account-row lock below.
  const key="telecom-statements/"+accountId+"/"+randomUUID()+".pdf";
  if (!PRIVATE_KEY.test(key)) throw new Error("Invalid private evidence path.");
  const evidenceHash=createHash("sha256").update(bytes).digest("hex");
  // Reserve key and audit under account lock before any external bytes are written.
  // A failed DB transaction must never leave an untracked private file.
  const result=await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx,actorUserId,["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "TelecomAccount" WHERE "id" = ${accountId} FOR UPDATE`;
    const latest=await tx.telecomStatement.findFirst({
      where:{accountId,externalId},orderBy:{revision:"desc"},select:{revision:true},
    });
    const row=await tx.telecomStatement.create({data:{
      accountId,externalId,revision:(latest?.revision??0)+1,
      periodStart,periodEnd,issueDate,currency:input.currency,
      invoiceTotalCents:input.invoiceTotalCents,
      vendorTaxCents:input.vendorTaxCents??null,
      privateEvidenceStorageKey:key,evidenceHash,state:"DRAFT",
    }});
    await tx.auditLog.create({data:{
      userId:actorUserId,action:"TELECOM_STATEMENT_DRAFT_RESERVED",
      entityType:"TelecomStatement",entityId:row.id,
      newValue:{accountId,revision:row.revision,periodStart:input.periodStart,
        periodEnd:input.periodEnd,hash:evidenceHash},
    }});
    return row;
  });
  await store.put(key, bytes);
  return {id:result.id,state:"DRAFT"};
}
/** Owner attests that the retained private PDF matches the exact statement. */
export async function verifyTelecomStatement(
  actorUserId:string, statementId:string,
  expectedHash:string, store:PrivateTelecomStatementStore=productionStatementStore,
):Promise<{state:"VERIFIED"}> {
  if (!HASH.test(expectedHash) || !/^[A-Za-z0-9_-]{8,128}$/.test(statementId)) {
    throw new Error("Invalid statement verification.");
  }
  await prisma.$transaction(tx=>assertActiveTeamActor(tx,actorUserId,["OWNER"]));
  const document=await prisma.telecomStatement.findUnique({where:{id:statementId},
    select:{id:true,state:true,evidenceHash:true,privateEvidenceStorageKey:true}});
  if (!document || document.state!=="DRAFT" || document.evidenceHash!==expectedHash ||
      !PRIVATE_KEY.test(document.privateEvidenceStorageKey) ||
      !(await matchesStoredStatement(store, document.privateEvidenceStorageKey, expectedHash))) {
    throw new Error("Statement evidence is missing or already verified.");
  }
  return prisma.$transaction(async tx=>{
    await assertActiveTeamActor(tx,actorUserId,["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "TelecomStatement" WHERE "id" = ${statementId} FOR UPDATE`;
    const updated=await tx.telecomStatement.updateMany({where:{
      id:statementId,state:"DRAFT",evidenceHash:expectedHash,
    },data:{state:"VERIFIED",verifiedByUserId:actorUserId,verifiedAt:new Date()}});
    if (updated.count!==1) throw new Error("Statement was changed. Refresh.");
    await tx.auditLog.create({data:{userId:actorUserId,
      action:"TELECOM_STATEMENT_VERIFIED",entityType:"TelecomStatement",
      entityId:statementId,newValue:{hash:expectedHash}}});
    return {state:"VERIFIED" as const};
  });
}

async function matchesStoredStatement(
  store: PrivateTelecomStatementStore, key: string, expectedHash: string,
): Promise<boolean> {
  const bytes = await store.read(key);
  if (!bytes) return false;
  try { safePdf(bytes); } catch { return false; }
  return createHash("sha256").update(bytes).digest("hex") === expectedHash;
}
/** Dollar input is exact, signed and stays integer cents at the UI boundary. */
export function parseTelecomStatementDollars(value: string): number {
  if (!/^-?\d{1,8}(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Enter an exact dollar amount with up to two decimals.");
  }
  const negative = value.startsWith("-");
  const [dollars, fraction=""] = (negative ? value.slice(1) : value).split(".");
  const cents = (Number(dollars)*100 + Number(fraction.padEnd(2,"0")))*(negative?-1:1);
  if (!Number.isSafeInteger(cents) || Math.abs(cents)>1_000_000_000) {
    throw new Error("Statement amount is outside supported limits.");
  }
  return cents === 0 ? 0 : cents;
}
