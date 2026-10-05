import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { describeSnapshotTerms } from "@/domains/agreements/terms-snapshot";
import { getCustomerStatement } from "@/domains/billing/statements";
import {
  RENDERER_VERSION,
  renderInvoice,
  renderSignedAgreement,
  renderStatement,
  type BusinessIdentity,
  type InvoicePayload,
  type SignedAgreementPayload,
  type StatementPayload,
} from "./render";

const FINAL_INVOICE_STATUSES = ["PAID", "VOID", "WRITTEN_OFF", "REFUNDED"] as const;

type Tx = Prisma.TransactionClient;

function json<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function businessFrom(settings: {
  publicBusinessName: string;
  publicPhone: string;
  publicEmail: string;
  publicAddress: string;
}): BusinessIdentity {
  return {
    name: settings.publicBusinessName,
    phone: settings.publicPhone,
    email: settings.publicEmail,
    address: settings.publicAddress,
  };
}

function serviceAddressLabel(address: {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
}): string {
  return `${address.line1}${address.line2 ? `, ${address.line2}` : ""}, ${address.city}, ${address.state} ${address.zip}`;
}

export async function createSignedAgreementArtifactInTx(tx: Tx, agreementId: string): Promise<string> {
  const [agreement, settings] = await Promise.all([
    tx.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementId },
      select: {
        id: true,
        customerId: true,
        termMonths: true,
        depositCents: true,
        damageWaiverCents: true,
        lateFeeGraceDays: true,
        lateFeeCents: true,
        lateFeePercent: true,
        taxRateMilliPercent: true,
        paidInFullInAdvance: true,
        freeMonthGranted: true,
        termsSnapshot: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
        serviceAddress: { select: { line1: true, line2: true, city: true, state: true, zip: true } },
        lines: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            label: true,
            monthlyPriceCents: true,
            listPriceCents: true,
            prepayDiscountCentsPerMonth: true,
          },
        },
        signature: {
          select: { signerName: true, signerEmail: true, ipAddress: true, signedAt: true },
        },
      },
    }),
    tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { publicBusinessName: true, publicPhone: true, publicEmail: true, publicAddress: true },
    }),
  ]);

  if (!agreement.signature?.signedAt || !agreement.signature.signerName || !agreement.signature.signerEmail) {
    throw new Error("The signed agreement evidence is incomplete.");
  }

  const lockedTerms = agreement.termMonths
    ? describeSnapshotTerms(agreement.termsSnapshot)
    : { ending: null, autoRenew: null };
  const payload: SignedAgreementPayload = {
    agreementId: agreement.id,
    business: businessFrom(settings),
    customer: {
      name: agreement.customer.user.name ?? agreement.customer.user.email,
      email: agreement.customer.user.email,
    },
    serviceAddress: serviceAddressLabel(agreement.serviceAddress),
    termMonths: agreement.termMonths,
    lines: agreement.lines,
    monthlyTotalCents: agreement.lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0),
    depositCents: agreement.depositCents,
    damageWaiverCents: agreement.damageWaiverCents,
    lateFeeGraceDays: agreement.lateFeeGraceDays,
    lateFeeCents: agreement.lateFeeCents,
    lateFeePercent: agreement.lateFeePercent,
    taxRateMilliPercent: agreement.taxRateMilliPercent,
    paidInFullInAdvance: agreement.paidInFullInAdvance,
    freeMonthGranted: agreement.freeMonthGranted,
    terms: lockedTerms,
    signature: {
      signerName: agreement.signature.signerName,
      signerEmail: agreement.signature.signerEmail,
      ipAddress: agreement.signature.ipAddress,
      signedAt: agreement.signature.signedAt.toISOString(),
    },
  };
  const html = renderSignedAgreement(payload);
  const hash = sha256(html);

  const existing = await tx.documentArtifact.findFirst({
    where: { kind: "SIGNED_AGREEMENT", subjectType: "RentalAgreement", subjectId: agreement.id },
    orderBy: { version: "desc" },
    select: { id: true, sha256: true },
  });
  if (existing) {
    if (existing.sha256 !== hash) throw new Error("Signed agreement evidence already exists with different content.");
    return existing.id;
  }

  const artifact = await tx.documentArtifact.create({
    data: {
      kind: "SIGNED_AGREEMENT",
      subjectType: "RentalAgreement",
      subjectId: agreement.id,
      customerId: agreement.customerId,
      version: 1,
      payload: json(payload),
      html,
      sha256: hash,
      rendererVersion: RENDERER_VERSION,
    },
    select: { id: true },
  });
  return artifact.id;
}

async function invoicePayloadInTx(tx: Tx, invoiceId: string): Promise<{ customerId: string; payload: InvoicePayload } | null> {
  const [invoice, settings] = await Promise.all([
    tx.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        customerId: true,
        billingPeriodStart: true,
        billingPeriodEnd: true,
        dueDate: true,
        createdAt: true,
        subtotalCents: true,
        discountCents: true,
        taxCents: true,
        lateFeeCents: true,
        amountDueCents: true,
        amountPaidCents: true,
        lineItems: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { description: true, quantity: true, amountCents: true },
        },
        customer: { select: { companyName: true, user: { select: { name: true, email: true } } } },
        agreement: { select: { serviceAddress: { select: { line1: true, line2: true, city: true, state: true, zip: true } } } },
      },
    }),
    tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { publicBusinessName: true, publicPhone: true, publicEmail: true, publicAddress: true },
    }),
  ]);
  if (!invoice || !FINAL_INVOICE_STATUSES.includes(invoice.status as (typeof FINAL_INVOICE_STATUSES)[number])) return null;
  return {
    customerId: invoice.customerId,
    payload: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      business: businessFrom(settings),
      customer: {
        name: invoice.customer.user.name ?? invoice.customer.user.email,
        companyName: invoice.customer.companyName,
        email: invoice.customer.user.email,
      },
      propertyAddress: invoice.agreement ? serviceAddressLabel(invoice.agreement.serviceAddress) : null,
      createdAt: invoice.createdAt.toISOString(),
      dueDate: invoice.dueDate?.toISOString() ?? null,
      billingPeriodStart: invoice.billingPeriodStart?.toISOString() ?? null,
      billingPeriodEnd: invoice.billingPeriodEnd?.toISOString() ?? null,
      lineItems: invoice.lineItems,
      subtotalCents: invoice.subtotalCents,
      discountCents: invoice.discountCents,
      taxCents: invoice.taxCents,
      lateFeeCents: invoice.lateFeeCents,
      amountDueCents: invoice.amountDueCents,
      amountPaidCents: invoice.amountPaidCents,
      balanceCents: Math.max(0, invoice.amountDueCents - invoice.amountPaidCents),
    },
  };
}

export async function freezeInvoiceArtifact(invoiceId: string): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const current = await invoicePayloadInTx(tx, invoiceId);
    if (!current) return null;
    const html = renderInvoice(current.payload);
    const hash = sha256(html);
    const latest = await tx.documentArtifact.findFirst({
      where: { kind: "INVOICE", subjectType: "Invoice", subjectId: invoiceId },
      orderBy: { version: "desc" },
      select: { id: true, version: true, sha256: true },
    });
    if (latest?.sha256 === hash) return latest.id;
    const artifact = await tx.documentArtifact.create({
      data: {
        kind: "INVOICE",
        subjectType: "Invoice",
        subjectId: invoiceId,
        customerId: current.customerId,
        version: (latest?.version ?? 0) + 1,
        payload: json(current.payload),
        html,
        sha256: hash,
        rendererVersion: RENDERER_VERSION,
      },
      select: { id: true },
    });
    return artifact.id;
  });
}

export async function freezeFinalInvoiceArtifacts(limit = 200): Promise<{ frozen: number }> {
  const bounded = Math.max(1, Math.min(limit, 200));
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT i."id"
    FROM "Invoice" i
    LEFT JOIN LATERAL (
      SELECT d."generatedAt"
      FROM "DocumentArtifact" d
      WHERE d."kind" = 'INVOICE'
        AND d."subjectType" = 'Invoice'
        AND d."subjectId" = i."id"
      ORDER BY d."version" DESC
      LIMIT 1
    ) latest ON true
    WHERE i."status" IN ('PAID', 'VOID', 'WRITTEN_OFF', 'REFUNDED')
      AND (latest."generatedAt" IS NULL OR i."updatedAt" > latest."generatedAt")
    ORDER BY i."updatedAt" ASC, i."id" ASC
    LIMIT ${bounded}
  `;
  let frozen = 0;
  for (const row of rows) {
    if (await freezeInvoiceArtifact(row.id)) frozen += 1;
  }
  return { frozen };
}

function statementPeriod(month: string): { start: Date; endInclusive: Date } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Statement month must use YYYY-MM.");
  const start = businessDateFromKey(`${month}-01`);
  if (!start || businessDateKey(start).slice(0, 7) !== month) throw new Error("Statement month is invalid.");
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
  const end = businessDateFromKey(`${next}-01`);
  if (!end) throw new Error("Statement month is invalid.");
  return { start, endInclusive: new Date(end.getTime() - 1) };
}

export async function statementArtifact(customerId: string, month: string): Promise<string> {
  const currentMonth = businessDateKey(new Date()).slice(0, 7);
  if (month >= currentMonth) throw new Error("Statements are available only after a Colorado business month has ended.");
  const period = statementPeriod(month);
  const [statement, settings] = await Promise.all([
    getCustomerStatement(customerId, { periodStart: period.start, periodEnd: period.endInclusive }),
    prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { publicBusinessName: true, publicPhone: true, publicEmail: true, publicAddress: true },
    }),
  ]);
  if (!statement) throw new Error("Customer not found.");
  const payload: StatementPayload = {
    month,
    business: businessFrom(settings),
    customer: { name: statement.customerName, companyName: statement.companyName },
    properties: statement.properties.map((property) => ({
      addressLabel: property.addressLabel,
      invoices: property.invoices.map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        dueDate: invoice.dueDate?.toISOString() ?? null,
        amountDueCents: invoice.amountDueCents,
        amountPaidCents: invoice.amountPaidCents,
        balanceCents: invoice.balanceCents,
      })),
      totalDueCents: property.totalDueCents,
      totalPaidCents: property.totalPaidCents,
      totalBalanceCents: property.totalBalanceCents,
    })),
    totalDueCents: statement.totalDueCents,
    totalPaidCents: statement.totalPaidCents,
    totalBalanceCents: statement.totalBalanceCents,
    reconciliation: statement.reconciliation,
  };
  const html = renderStatement(payload);
  const hash = sha256(html);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    const latest = await tx.documentArtifact.findFirst({
      where: { kind: "STATEMENT", subjectType: "CustomerStatement", subjectId: `${customerId}:${month}` },
      orderBy: { version: "desc" },
      select: { id: true, version: true, sha256: true },
    });
    if (latest?.sha256 === hash) return latest.id;
    const created = await tx.documentArtifact.create({
      data: {
        kind: "STATEMENT",
        subjectType: "CustomerStatement",
        subjectId: `${customerId}:${month}`,
        customerId,
        version: (latest?.version ?? 0) + 1,
        payload: json(payload),
        html,
        sha256: hash,
        rendererVersion: RENDERER_VERSION,
      },
      select: { id: true },
    });
    return created.id;
  });
}

export async function readArtifactForViewer(
  artifactId: string,
  viewer: { userId: string; role: string },
): Promise<{ html: string; filename: string } | null> {
  const artifact = await prisma.documentArtifact.findUnique({
    where: { id: artifactId },
    select: { id: true, kind: true, subjectId: true, customerId: true, version: true, html: true },
  });
  if (!artifact) return null;
  if (viewer.role === "STAFF") return null;
  if (viewer.role !== "OWNER" && viewer.role !== "ADMIN") {
    if (viewer.role !== "CUSTOMER") return null;
    const customer = await prisma.customer.findUnique({ where: { userId: viewer.userId }, select: { id: true, archivedAt: true } });
    if (!customer || customer.archivedAt || customer.id !== artifact.customerId) return null;
  }
  const prefix = artifact.kind === "SIGNED_AGREEMENT" ? "agreement" : artifact.kind === "INVOICE" ? "invoice" : "statement";
  return { html: artifact.html, filename: `${prefix}-${artifact.subjectId.replaceAll(":", "-")}-v${artifact.version}.html` };
}

export async function latestArtifactId(kind: "SIGNED_AGREEMENT" | "INVOICE", subjectId: string): Promise<string | null> {
  const artifact = await prisma.documentArtifact.findFirst({
    where: { kind, subjectId },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  return artifact?.id ?? null;
}
