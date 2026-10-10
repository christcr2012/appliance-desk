import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { twoFactorEnrollmentRequired } from "@/domains/security/two-factor";
import { uploadTelecomStatement, verifyTelecomStatement, productionStatementStore, parseTelecomStatementDollars } from "@/domains/messaging/telecom-statements";
import { communicationsPolicySchema, saveCommunicationsPolicy } from "@/domains/messaging/communications-policy";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { assertActiveTeamActor } from "@/lib/team-actor";

export const runtime = "nodejs";
const MAX_UPLOAD = 4 * 1024 * 1024;
function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "Unable to save telecom setup.";
  return NextResponse.json({ error: message }, { status: 400 });
}
function dollarsToCents(value: FormDataEntryValue | null): number {
  if (typeof value !== "string") throw new Error("Enter an exact dollar amount.");
  return parseTelecomStatementDollars(value);
}
export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin) {
    return NextResponse.json({error:"Invalid request origin."},{status:403});
  }
  const session = await getServerSession();
  if (!session) return NextResponse.json({error:"Sign in required."},{status:401});
  if (await twoFactorEnrollmentRequired(session.user.id,session.user.role)) {
    return NextResponse.json({error:"Two-step enrollment is required."},{status:403});
  }
  if (session.user.role !== "OWNER") {
    return NextResponse.json({error:"Only the Owner may change telecom setup."},{status:403});
  }
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD + 64_000) return NextResponse.json({error:"PDF exceeds 4 MB."},{status:413});
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.startsWith("application/json")) {
      const body = await req.json() as Record<string, unknown>;
      if (body.kind === "verify") {
        const result = await verifyTelecomStatement(
          session.user.id, String(body.statementId ?? ""), String(body.hash ?? ""));
        return NextResponse.json(result);
      }
      if (body.kind === "budget") {
        const rules = body.rules;
        const expected = body.expectedVersion;
        if (!Number.isSafeInteger(expected) || typeof expected !== "number" ||
            !rules || typeof rules !== "object" || Array.isArray(rules)) {
          return NextResponse.json({error:"Invalid settings."},{status:400});
        }
        const config = await prisma.businessSettings.findUnique({
          where:{id:"singleton"},select:{communicationsPolicy:true,communicationsPolicyVersion:true},
        });
        const existing = communicationsPolicySchema.safeParse(config?.communicationsPolicy);
        if (!config || config.communicationsPolicyVersion !== expected) {
          throw new Error("Communications policy changed. Refresh.");
        }
        if (existing.success && (existing.data.manualSmsEnabled || existing.data.voiceRoutingEnabled)) {
          throw new Error("Budget edits to active communications need separate approval.");
        }
        let base: Record<string,unknown>;
        if (existing.success) base = existing.data;
        else {
          const accountId = String(body.accountId ?? "");
          const primary = await prisma.businessPhoneNumber.findFirst({
            where: {accountId, isPrimary:true, retiredAt:null}, select:{id:true},
          });
          if (!primary) throw new Error("A recorded primary number is needed for provider setup.");
          base = {schemaVersion:1, manualSmsEnabled:false, inboundSmsEnabled:false,
            voiceRoutingEnabled:false, primaryAccountId:accountId,
            primaryNumberId:primary.id, maxSegments:3, supportedCountries:["US"]};
        }
        const parsed = communicationsPolicySchema.parse({
          ...base, telecomCostAlerts:rules, approvedPolicyVersion:expected+1,
        });
        // Even an owner-saved budget preference is only a preview until IN-53.
        const saved = await saveCommunicationsPolicy(session.user.id,parsed,expected);
        return NextResponse.json({status:"saved",version:saved.version});
      }
      return NextResponse.json({error:"Unknown telecom action."},{status:400});
    }
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({error:"PDF upload required."},{status:415});
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > MAX_UPLOAD || file.size < 30) {
      return NextResponse.json({error:"Select a PDF no larger than 4 MB."},{status:400});
    }
    const invoiceTotalCents = dollarsToCents(form.get("amountDollars"));
    const result = await uploadTelecomStatement({
      actorUserId:session.user.id,
      accountId:String(form.get("accountId") ?? ""),
      externalId:String(form.get("externalId") ?? ""),
      periodStart:String(form.get("periodStart") ?? ""),
      periodEnd:String(form.get("periodEnd") ?? ""),
      issueDate:String(form.get("issueDate") ?? ""),
      currency:String(form.get("currency") ?? "USD"),
      invoiceTotalCents,
      bytes:new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session) return NextResponse.json({error:"Sign in required."},{status:401});
  if (await twoFactorEnrollmentRequired(session.user.id,session.user.role)) {
    return NextResponse.json({error:"Two-step enrollment is required."},{status:403});
  }
  if (session.user.role !== "OWNER" && session.user.role !== "ADMIN") {
    return NextResponse.json({error:"Not found."},{status:404});
  }
  const id = new URL(req.url).searchParams.get("statement");
  if (!id || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
    return NextResponse.json({error:"Not found."},{status:404});
  }
  try {
    await prisma.$transaction(tx =>
      assertActiveTeamActor(tx, session.user.id, ["OWNER","ADMIN"]));
    const row = await prisma.telecomStatement.findUnique({
      where:{id},select:{privateEvidenceStorageKey:true,evidenceHash:true},
    });
    if (!row || !/^telecom-statements\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.pdf$/.test(row.privateEvidenceStorageKey)) {
      return NextResponse.json({error:"Not found."},{status:404});
    }
    const bytes = await productionStatementStore.read(row.privateEvidenceStorageKey);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== row.evidenceHash) {
      return NextResponse.json({error:"Evidence cannot be verified."},{status:502});
    }
    return new Response(Buffer.from(bytes), {status:200,headers:{
      "content-type":"application/pdf",
      "content-disposition":"attachment; filename=telecom-statement.pdf",
      "cache-control":"private, no-store",
      "x-content-type-options":"nosniff",
    }});
  } catch {
    return NextResponse.json({error:"Private statement is unavailable."},{status:503});
  }
}
