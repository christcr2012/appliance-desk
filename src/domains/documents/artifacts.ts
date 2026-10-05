import { createHash } from "node:crypto";
import { Prisma, type DocumentArtifactKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBusinessSettings } from "@/domains/settings";
import { describeSnapshotTerms } from "@/domains/agreements/terms-snapshot";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { getCustomerStatement } from "@/domains/billing/statements";
import { businessDateFromKey, businessDateKey, businessMonthBounds } from "@/lib/business-date";
import {
  RENDERER_VERSION,
  renderInvoice,
  renderSignedAgreement,
  renderStatement,
  type BusinessBlock,
  type InvoicePayload,
  type SignedAgreementPayload,
  type StatementPayload,
} from "./render";

// ---------------------------------------------------------------------------
// Saved copies of documents (Batch D, D6): the render input (payload), the text
// produced from it, and a SHA-256 of that text. A saved copy is never edited;
// if a final invoice later changes, the next version is saved beside it.
// ---------------------------------------------------------------------------

export const FINAL_INVOICE_STATUSES = ["PAID", "VOID", "WRITTEN_OFF", "REFUNDED"] as const;

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** JSON text with keys sorted, so a payload read back from the database compares equal to the one that was saved. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

type Tx = Prisma.TransactionClient;
type Db = Pick<Tx, "documentArtifact">;

async function businessBlock(): Promise<BusinessBlock> {
  const s = await getBusinessSettings();
  return { name: s.publicBusinessName, phone: s.publicPhone, email: s.publicEmail, address: s.publicAddress };
}

async function insertVersion(
  db: Db,
  input: {
    kind: DocumentArtifactKind;
    subjectType: string;
    subjectId: string;
    customerId: string;
    payload: unknown;
    html: string;
    generatedByUserId?: string | null;
  },
): Promise<string> {
  const latest = await db.documentArtifact.findFirst({
    where: { kind: input.kind, subjectType: input.subjectType, subjectId: input.subjectId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const row = await db.documentArtifact.create({
    data: {
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      customerId: input.customerId,
      version: (latest?.version ?? 0) + 1,
      payload: input.payload as Prisma.InputJsonValue,
      html: input.html,
      sha256: sha256Hex(input.html),
      rendererVersion: RENDERER_VERSION,
      generatedByUserId: input.generatedByUserId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/** The signed copy of an agreement, written inside the signing transaction (signing fails if this cannot be saved). */
export async function createSignedAgreementArtifactInTx(tx: Tx, agreementId: string): Promise<string> {
  const existing = await tx.documentArtifact.findFirst({
    where: { kind: "SIGNED_AGREEMENT", subjectType: "RentalAgreement", subjectId: agreementId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      serviceAddress: true,
      lines: { orderBy: { createdAt: "asc" } },
      signature: true,
    },
  });
  const sig = agreement.signature;
  if (!sig?.signedAt || !sig.signerName || !sig.signerEmail) {
    throw new Error("This agreement has not been signed yet.");
  }
  const a = agreement.serviceAddress;
  // The same wording rule as the signing page: fixed terms show their locked text; month-to-month shows none here.
  const terms = agreement.termMonths
    ? describeSnapshotTerms(agreement.termsSnapshot)
    : { ending: null, autoRenew: null };
  const payload: SignedAgreementPayload = {
    agreementId,
    business: await businessBlock(),
    customerName: agreement.customer.user.name ?? agreement.customer.user.email,
    customerEmail: agreement.customer.user.email,
    serviceAddress: `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${a.state} ${a.zip}`,
    termMonths: agreement.termMonths,
    lines: agreement.lines.map((l) => ({
      label: l.label,
      monthlyPriceCents: l.monthlyPriceCents,
      listPriceCents: l.listPriceCents,
      prepayDiscountCentsPerMonth: l.prepayDiscountCentsPerMonth,
    })),
    monthlyTotalCents: agreement.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
    freeMonthGranted: agreement.freeMonthGranted,
    depositCents: agreement.depositCents,
    damageWaiverCents: agreement.damageWaiverCents,
    lateFeeGraceDays: agreement.lateFeeGraceDays,
    lateFeeCents: agreement.lateFeeCents,
    lateFeePercent: agreement.lateFeePercent,
    taxRateMilliPercent: agreement.taxRateMilliPercent,
    terms,
    signerName: sig.signerName,
    signerEmail: sig.signerEmail,
    signerIp: sig.ipAddress,
    signedAtIso: sig.signedAt.toISOString(),
  };
  return insertVersion(tx, {
    kind: "SIGNED_AGREEMENT",
    subjectType: "RentalAgreement",
    subjectId: agreementId,
    customerId: agreement.customerId,
    payload,
    html: renderSignedAgreement(payload),
  });
}

async function invoicePayload(invoiceId: string): Promise<{ payload: InvoicePayload; customerId: string } | null> {
  const d = await getInvoiceDetail(invoiceId);
  if (!d) return null;
  return {
    customerId: d.customer.id,
    payload: {
      invoiceId: d.id,
      invoiceNumber: d.invoiceNumber,
      status: d.status,
      business: { name: d.business.name, phone: d.business.phone, email: d.business.email, address: d.business.address },
      customerName: d.customer.name,
      customerCompany: d.customer.companyName,
      customerEmail: d.customer.email,
      propertyAddress: d.propertyAddress,
      billingPeriodStartIso: d.billingPeriodStart?.toISOString() ?? null,
      billingPeriodEndIso: d.billingPeriodEnd?.toISOString() ?? null,
      dueDateIso: d.dueDate?.toISOString() ?? null,
      createdAtIso: d.createdAt.toISOString(),
      lineItems: d.lineItems.map((l) => ({ description: l.description, quantity: l.quantity, amountCents: l.amountCents })),
      subtotalCents: d.subtotalCents,
      discountCents: d.discountCents,
      taxCents: d.taxCents,
      lateFeeCents: d.lateFeeCents,
      amountDueCents: d.amountDueCents,
      amountPaidCents: d.amountPaidCents,
      balanceCents: d.balanceCents,
      payments: d.payments.map((p) => ({
        amountCents: p.amountCents, method: p.method, status: p.status, createdAtIso: p.createdAt.toISOString(),
      })),
    },
  };
}

/**
 * Saves the invoice as it stands now when it is in a final state. Returns the id of the newest saved copy, or null
 * while the invoice is not final. Saving again after a change makes version 2 (version 1 is never edited).
 */
export async function freezeInvoiceArtifact(invoiceId: string, actorUserId?: string | null): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const built = await invoicePayload(invoiceId);
    if (!built || !(FINAL_INVOICE_STATUSES as readonly string[]).includes(built.payload.status)) return null;
    const latest = await prisma.documentArtifact.findFirst({
      where: { kind: "INVOICE", subjectType: "Invoice", subjectId: invoiceId },
      orderBy: { version: "desc" },
      select: { id: true, payload: true },
    });
    if (latest && canonicalJson(latest.payload) === canonicalJson(built.payload)) return latest.id;
    try {
      return await insertVersion(prisma, {
        kind: "INVOICE",
        subjectType: "Invoice",
        subjectId: invoiceId,
        customerId: built.customerId,
        payload: built.payload,
        html: renderInvoice(built.payload),
        generatedByUserId: actorUserId,
      });
    } catch (error) {
      // A second request saved the same version first: look again.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
  throw new Error("Could not save the invoice copy. Please try again.");
}

/** Nightly sweep: saves a first copy of final invoices that have none. Bounded; returns how many it saved. */
export async function freezeFinalInvoiceArtifacts(limit = 200): Promise<{ checked: number; saved: number; failed: number }> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT i."id" FROM "Invoice" i
    WHERE i."status"::text IN ('PAID','VOID','WRITTEN_OFF','REFUNDED')
      AND NOT EXISTS (
        SELECT 1 FROM "DocumentArtifact" d
        WHERE d."kind"::text = 'INVOICE' AND d."subjectType" = 'Invoice' AND d."subjectId" = i."id"
      )
    ORDER BY i."createdAt" ASC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}`;
  let saved = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (await freezeInvoiceArtifact(row.id)) saved++;
    } catch (error) {
      failed++;
      console.error("[documents] could not save an invoice copy", row.id, error instanceof Error ? error.message : error);
    }
  }
  return { checked: rows.length, saved, failed };
}

/** A customer's statement for a finished Colorado month (YYYY-MM). The current or a future month is refused. */
export async function statementArtifact(customerId: string, month: string, actorUserId?: string | null): Promise<string> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Choose a month like 2026-09.");
  const first = businessDateFromKey(`${month}-01`);
  if (!first) throw new Error("Choose a month like 2026-09.");
  const currentMonth = businessDateKey(new Date()).slice(0, 7);
  if (month >= currentMonth) throw new Error("A statement is only available once the month has ended.");

  const existing = await prisma.documentArtifact.findFirst({
    where: { kind: "STATEMENT", subjectType: "CustomerMonth", subjectId: `${customerId}:${month}` },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const bounds = businessMonthBounds(first);
  const statement = await getCustomerStatement(customerId, {
    periodStart: bounds.start,
    periodEnd: new Date(bounds.end.getTime() - 1),
  });
  if (!statement) throw new Error("That customer could not be found.");
  const invoices = statement.properties.flatMap((p) => p.invoices);
  const payload: StatementPayload = {
    customerId,
    month,
    business: await businessBlock(),
    customerName: statement.customerName,
    customerCompany: statement.companyName,
    invoices: invoices
      .map((i) => ({
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        billingPeriodStartIso: i.billingPeriodStart?.toISOString() ?? null,
        amountDueCents: i.amountDueCents,
        amountPaidCents: i.amountPaidCents,
        balanceCents: i.balanceCents,
      }))
      .sort((x, y) => x.invoiceNumber - y.invoiceNumber),
    totalDueCents: statement.totalDueCents,
    totalPaidCents: statement.totalPaidCents,
    totalBalanceCents: statement.totalBalanceCents,
  };
  try {
    return await insertVersion(prisma, {
      kind: "STATEMENT",
      subjectType: "CustomerMonth",
      subjectId: `${customerId}:${month}`,
      customerId,
      payload,
      html: renderStatement(payload),
      generatedByUserId: actorUserId,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await prisma.documentArtifact.findFirst({
        where: { kind: "STATEMENT", subjectType: "CustomerMonth", subjectId: `${customerId}:${month}` },
        select: { id: true },
      });
      if (again) return again.id;
    }
    throw error;
  }
}

/** OWNER/ADMIN may see any saved copy; STAFF signed agreements only; a customer only their own. */
export async function canViewDocument(
  viewer: { userId: string; role: string },
  kind: DocumentArtifactKind,
  customerId: string,
): Promise<boolean> {
  if (viewer.role === "OWNER" || viewer.role === "ADMIN") return true;
  if (viewer.role === "STAFF") return kind === "SIGNED_AGREEMENT";
  if (viewer.role === "CUSTOMER") {
    const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { userId: true } });
    return c?.userId === viewer.userId;
  }
  return false;
}

/** The saved copy for a viewer, or null when they may not see it (or it does not exist). */
export async function readArtifactForViewer(
  artifactId: string,
  viewer: { userId: string; role: string },
): Promise<{ html: string; filename: string; sha256: string } | null> {
  const a = await prisma.documentArtifact.findUnique({
    where: { id: artifactId },
    select: { kind: true, html: true, sha256: true, version: true, customerId: true },
  });
  if (!a || !(await canViewDocument(viewer, a.kind, a.customerId))) return null;
  const base = a.kind === "SIGNED_AGREEMENT" ? "signed-agreement" : a.kind === "INVOICE" ? "invoice" : "statement";
  return { html: a.html, filename: `${base}-v${a.version}.html`, sha256: a.sha256 };
}

/**
 * Finds (or, for a final invoice or a finished statement month, first saves) the newest copy a viewer asked for.
 * Returns null when it does not exist or the viewer may not see it; the two look the same on purpose.
 */
export async function resolveArtifactForViewer(
  viewer: { userId: string; role: string },
  request: { kind: "agreement" | "invoice" | "statement"; id: string; month?: string },
): Promise<string | null> {
  if (request.kind === "agreement") {
    const a = await prisma.documentArtifact.findFirst({
      where: { kind: "SIGNED_AGREEMENT", subjectType: "RentalAgreement", subjectId: request.id },
      orderBy: { version: "desc" },
      select: { id: true, customerId: true },
    });
    return a && (await canViewDocument(viewer, "SIGNED_AGREEMENT", a.customerId)) ? a.id : null;
  }
  if (request.kind === "invoice") {
    const inv = await prisma.invoice.findUnique({ where: { id: request.id }, select: { customerId: true } });
    if (!inv || !(await canViewDocument(viewer, "INVOICE", inv.customerId))) return null;
    return freezeInvoiceArtifact(request.id, viewer.role === "CUSTOMER" ? null : viewer.userId);
  }
  if (!request.month || !(await canViewDocument(viewer, "STATEMENT", request.id))) return null;
  try {
    return await statementArtifact(request.id, request.month, viewer.role === "CUSTOMER" ? null : viewer.userId);
  } catch {
    return null;
  }
}
