import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { roundTelecomTotalToCents, telecomDecimal } from "./telecom-decimal";

export const TELECOM_STALE_HOURS = 48;
export function telecomIssueScope(accountId:string):string {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(accountId)) throw new Error("Invalid account scope");
  return createHash("sha256").update(accountId).digest("hex").slice(0,20);
}
export type TelecomHealthFinding = {
  kind: "TELECOM_SYNC_STALE" | "TELECOM_STATEMENT_DIFFERENCE";
  scope:string; period?:string;
  lastSuccessAt?:Date; lastFailureAt?:Date;
};
export function telecomSyncFinding(input:{
  status:"READY"|"DEGRADED"|"DISABLED"|"UNCONFIGURED";
  scope:string; lastSuccessAt:Date|null; lastFailureAt:Date|null; now:Date;
}):TelecomHealthFinding|null {
  if (!["READY","DEGRADED"].includes(input.status) || !input.lastSuccessAt ||
      !Number.isFinite(+input.now) || !Number.isFinite(+input.lastSuccessAt)) return null;
  if (+input.now-+input.lastSuccessAt <= TELECOM_STALE_HOURS*3600_000 &&
      (!input.lastFailureAt || +input.lastFailureAt<=+input.lastSuccessAt)) return null;
  return {kind:"TELECOM_SYNC_STALE",scope:input.scope,
    lastSuccessAt:input.lastSuccessAt,lastFailureAt:input.lastFailureAt??undefined};
}
export function telecomStatementFinding(input: {
  scope:string; period:string; verifiedCents:number; currency:string;
  observations:readonly {price:Prisma.Decimal|null;currency:string;providerAsOf:Date;capturedAt:Date}[];
}):TelecomHealthFinding|null {
  if (!Number.isSafeInteger(input.verifiedCents)) throw new Error('Invalid cents');
  if (input.observations.some(row=>row.currency!==input.currency)) return null;
  const ordered=[...input.observations].sort((a,b)=>+b.providerAsOf-+a.providerAsOf || +b.capturedAt-+a.capturedAt);
  const price=ordered[0]?.price;
  if (price===null || price===undefined) return null;
  const cents=roundTelecomTotalToCents(telecomDecimal(price));
  return cents===input.verifiedCents ? null : {kind:'TELECOM_STATEMENT_DIFFERENCE',scope:input.scope,period:input.period};
}
