import type {
  Prisma,
  TaxExemptionReason,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey, businessDayBounds } from "@/lib/business-date";
import { allocateAcrossLines } from "@/domains/tax/allocate";
import { shopSaleFeeKeptOnReturnInTx } from "@/domains/tax/rdf-shop-sale";

export type TaxExemptionInput = {
  reason: TaxExemptionReason;
  certificateNumber?: string | null;
  certificatePhotoId?: string | null;
  jurisdictionIds?: string[];
  validFrom: Date;
  expiresOn?: Date | null;
  notes?: string | null;
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeJurisdictionIds(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
}

function validateDates(validFrom: Date, expiresOn: Date | null): void {
  if (Number.isNaN(validFrom.getTime())) {
    throw new Error("Enter a valid exemption start date.");
  }
  if (expiresOn && Number.isNaN(expiresOn.getTime())) {
    throw new Error("Enter a valid exemption expiration date.");
  }
  if (expiresOn && expiresOn.getTime() < validFrom.getTime()) {
    throw new Error("The exemption expiration date cannot be before its start date.");
  }
}

async function assertJurisdictionsExist(
  tx: Prisma.TransactionClient,
  jurisdictionIds: string[],
): Promise<void> {
  if (jurisdictionIds.length === 0) return;
  const found = await tx.taxJurisdiction.findMany({
    where: { id: { in: jurisdictionIds } },
    select: { id: true },
  });
  if (found.length !== jurisdictionIds.length) {
    throw new Error("One or more selected tax jurisdictions no longer exist.");
  }
}

async function lockCustomerTaxExemptionInTx(
  tx: Prisma.TransactionClient,
  exemptionId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "CustomerTaxExemption"
    WHERE "id" = ${exemptionId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error("Couldn't find that tax exemption.");
  }
  return tx.customerTaxExemption.findUniqueOrThrow({
    where: { id: exemptionId },
  });
}

async function exemptionDataInTx(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  input: TaxExemptionInput,
) {
  const expiresOn = input.expiresOn ?? null;
  validateDates(input.validFrom, expiresOn);
  const jurisdictionIds = normalizeJurisdictionIds(input.jurisdictionIds);
  await assertJurisdictionsExist(tx, jurisdictionIds);
  const certificatePhotoId = normalizeOptionalText(input.certificatePhotoId);
  if (!certificatePhotoId) {
    throw new Error("Add a private photo of the tax-exemption certificate before saving it.");
  }

  return {
    reason: input.reason,
    certificateNumber: normalizeOptionalText(input.certificateNumber),
    certificatePhotoId,
    jurisdictionIds,
    validFrom: input.validFrom,
    expiresOn,
    verifiedByUserId: actorUserId,
    notes: normalizeOptionalText(input.notes),
  };
}

export async function listCustomerTaxExemptions(
  actorUserId: string,
  customerId: string,
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { id: true },
    });
    return tx.customerTaxExemption.findMany({
      where: { customerId },
      orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
  });
}

export async function listCustomerTaxExemptionJurisdictions(
  actorUserId: string,
  customerId: string,
): Promise<Array<{ id: string; name: string; level: string }>> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const [addresses, exemptions] = await Promise.all([
      tx.serviceAddress.findMany({
        where: { customerId },
        select: {
          taxLocations: {
            where: { isCurrent: true },
            select: {
              jurisdictions: {
                select: {
                  jurisdiction: {
                    select: { id: true, name: true, level: true },
                  },
                },
              },
            },
          },
        },
      }),
      tx.customerTaxExemption.findMany({
        where: { customerId },
        select: { jurisdictionIds: true },
      }),
    ]);
    const unique = new Map<string, { id: string; name: string; level: string }>();
    for (const address of addresses) {
      for (const location of address.taxLocations) {
        for (const row of location.jurisdictions) {
          unique.set(row.jurisdiction.id, {
            id: row.jurisdiction.id,
            name: row.jurisdiction.name,
            level: row.jurisdiction.level,
          });
        }
      }
    }
    const historicalIds = [
      ...new Set(
        exemptions.flatMap((exemption) =>
          Array.isArray(exemption.jurisdictionIds)
            ? exemption.jurisdictionIds.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        ),
      ),
    ].filter((id) => !unique.has(id));
    if (historicalIds.length > 0) {
      const historical = await tx.taxJurisdiction.findMany({
        where: { id: { in: historicalIds } },
        select: { id: true, name: true, level: true },
      });
      for (const jurisdiction of historical) {
        unique.set(jurisdiction.id, {
          id: jurisdiction.id,
          name: jurisdiction.name,
          level: jurisdiction.level,
        });
      }
    }
    return [...unique.values()].sort(
      (left, right) =>
        left.level.localeCompare(right.level) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    );
  });
}

export async function createCustomerTaxExemption(
  actorUserId: string,
  customerId: string,
  input: TaxExemptionInput,
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    // Serialize certificate creation per customer so two back-dated
    // certificates cannot both credit the same historical tax.
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { id: true },
    });
    const data = await exemptionDataInTx(tx, actorUserId, input);
    const row = await tx.customerTaxExemption.create({
      data: { ...data, customerId },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "tax.exemption_created",
        entityType: "CustomerTaxExemption",
        entityId: row.id,
        newValue: {
          customerId,
          reason: row.reason,
          jurisdictionIds: row.jurisdictionIds,
          validFrom: row.validFrom.toISOString(),
          expiresOn: row.expiresOn?.toISOString() ?? null,
          certificateOnFile: Boolean(row.certificateNumber || row.certificatePhotoId),
        },
      },
    });
    // TFA-2 §9: a certificate that was already in force while earlier
    // bills were taxed earns the customer a credit for the tax charged
    // since it took effect. Issued bills stay exactly as they are; the
    // credit lands on a future bill (the section 4a pattern).
    const validKey = businessDateKey(row.validFrom);
    if (validKey < businessDateKey(new Date())) {
      const since = businessDateFromKey(validKey);
      // Only tax the certificate actually covered counts: nothing charged
      // after its expiration day.
      const until = row.expiresOn ? businessDayBounds(row.expiresOn).end : null;
      const taxedInvoices = await tx.invoice.findMany({
        where: {
          customerId,
          status: { notIn: ["DRAFT", "VOID", "WRITTEN_OFF"] },
          issuedAt: { gte: since!, ...(until ? { lt: until } : {}) },
          taxLines: { some: { taxCents: { gt: 0 } } },
        },
        select: {
          id: true, amountDueCents: true,
          taxLines: { select: { jurisdictionId: true, taxCents: true } },
          refunds: { select: { amountCents: true } },
        },
        orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
      });
      // The credit is tracked per invoice from the start: a later refund
      // on one of these invoices must not hand the same tax back a second
      // time, and the refund path can only enforce that if it knows how
      // much of THIS invoice's tax was already credited (see
      // exemptionBackdateCreditCentsForInvoiceInTx below).
      const perInvoice: Array<{ invoiceId: string; cents: number }> = [];
      for (const invoice of taxedInvoices) {
        const lines = invoice.taxLines;
        const totalTax = lines.reduce((sum, line) => sum + line.taxCents, 0);
        const totalRefunds = invoice.refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
        // Mirror the filing packet's refund allocation: a refund returns
        // tax and principal in proportion, so only the unrefunded share
        // of each tax line can still be credited here — the customer must
        // never receive the same tax back twice. The allocation base
        // excludes a delivery fee the customer never gets back on a
        // return (it is not part of any refund, so no refund share may
        // be attributed to it). An invoice whose numbers do not
        // reconcile earns no credit (the packet blocks filing on it for
        // the same reason; the owner can credit by hand).
        const keptFeeCents = await shopSaleFeeKeptOnReturnInTx(tx, invoice.id);
        const basisCents = invoice.amountDueCents - keptFeeCents;
        if (basisCents <= 0 || totalTax < 0 || totalTax > basisCents
          || totalRefunds < 0 || totalRefunds > basisCents
          || lines.some((line) => line.taxCents < 0)) continue;
        const taxRefunded = totalRefunds === 0 ? 0
          : allocateAcrossLines(totalRefunds, [totalTax, basisCents - totalTax])[0]!;
        const perLineRefunded = taxRefunded === 0 ? lines.map(() => 0)
          : allocateAcrossLines(taxRefunded, lines.map((line) => line.taxCents));
        let invoiceCents = 0;
        lines.forEach((line, index) => {
          if (line.taxCents <= 0) return;
          if (data.jurisdictionIds.length && !data.jurisdictionIds.includes(line.jurisdictionId)) return;
          invoiceCents += line.taxCents - perLineRefunded[index]!;
        });
        if (invoiceCents > 0) perInvoice.push({ invoiceId: invoice.id, cents: invoiceCents });
      }
      let creditCents = perInvoice.reduce((sum, entry) => sum + entry.cents, 0);
      if (creditCents > 0) {
        // Never credit the same tax twice: subtract back-dated credits
        // already granted for certificates whose covered days and areas
        // overlap this one. Partial day/area overlap subtracts the whole
        // earlier credit, so any error credits too little (the owner can
        // add a manual credit) rather than paying the same tax twice.
        const priorCredits = await tx.customerCredit.findMany({
          where: { customerId, sourceType: "EXEMPTION_BACKDATE" },
          select: { id: true, amountCents: true, sourceId: true },
        });
        const priorIds = [...new Set(priorCredits.map((credit) => credit.sourceId).filter((id): id is string => !!id))];
        if (priorIds.length) {
          const priorRows = await tx.customerTaxExemption.findMany({
            where: { id: { in: priorIds }, customerId },
            select: { id: true, validFrom: true, expiresOn: true, jurisdictionIds: true },
          });
          const priorById = new Map(priorRows.map((prior) => [prior.id, prior]));
          // Earlier grants recorded which invoices their credit covered;
          // those shares come off the SAME invoices here, never off a
          // different bill (the review's case: a certificate that
          // credited only the newer invoice must not leave the older
          // one's tax looking uncredited, or a later refund pays it
          // twice while the newer bill is wrongly capped).
          const priorGrants = await tx.auditLog.findMany({
            where: {
              action: "tax.exemption.backdate_credit", entityType: "CustomerCredit",
              entityId: { in: priorCredits.map((credit) => credit.id) },
            },
            select: { entityId: true, newValue: true },
          });
          const splitByCreditId = new Map<string, Array<{ invoiceId: string; cents: number }>>();
          for (const grant of priorGrants) {
            const value = (grant.newValue ?? {}) as {
              perInvoice?: Array<{ invoiceId?: string; cents?: number }>;
            };
            if (!grant.entityId || !Array.isArray(value.perInvoice)) continue;
            splitByCreditId.set(grant.entityId, value.perInvoice.filter(
              (entry): entry is { invoiceId: string; cents: number } =>
                typeof entry.invoiceId === "string" && typeof entry.cents === "number",
            ));
          }
          let priorTotal = 0;
          const priorPerInvoice = new Map<string, number>();
          for (const credit of priorCredits) {
            const prior = credit.sourceId ? priorById.get(credit.sourceId) : undefined;
            if (!prior) continue;
            const priorFrom = businessDateFromKey(businessDateKey(prior.validFrom))!;
            const priorUntil = prior.expiresOn ? businessDayBounds(prior.expiresOn).end : null;
            const daysOverlap = priorFrom < (until ?? new Date(8_640_000_000_000_000)) && (!priorUntil || priorUntil > since!);
            if (!daysOverlap) continue;
            const priorAreas = Array.isArray(prior.jurisdictionIds)
              ? prior.jurisdictionIds.filter((value): value is string => typeof value === "string")
              : [];
            const areasOverlap = !data.jurisdictionIds.length || !priorAreas.length
              || data.jurisdictionIds.some((id) => priorAreas.includes(id));
            if (!areasOverlap) continue;
            priorTotal += credit.amountCents;
            for (const entry of splitByCreditId.get(credit.id) ?? []) {
              priorPerInvoice.set(entry.invoiceId,
                (priorPerInvoice.get(entry.invoiceId) ?? 0) + entry.cents);
            }
          }
          creditCents -= priorTotal;
          // Subtract each earlier grant's recorded share from its own
          // invoice first. Only what no recorded split accounts for
          // (shares on invoices outside this grant, or a grant too old
          // to have a split) is spread earliest-first, so the totals
          // still match the aggregate and any error under-credits.
          let unsubtracted = priorTotal;
          for (const entry of perInvoice) {
            const share = Math.min(entry.cents, priorPerInvoice.get(entry.invoiceId) ?? 0);
            entry.cents -= share;
            unsubtracted -= share;
          }
          for (const entry of perInvoice) {
            if (unsubtracted <= 0) break;
            const cut = Math.min(entry.cents, unsubtracted);
            entry.cents -= cut;
            unsubtracted -= cut;
          }
        }
      }
      if (creditCents > 0) {
        const credit = await tx.customerCredit.create({
          data: {
            customerId,
            amountCents: creditCents,
            remainingCents: creditCents,
            reason: "Exemption certificate covered this tax",
            authorizedByUserId: actorUserId,
            sourceType: "EXEMPTION_BACKDATE",
            sourceId: row.id,
            side: "CUSTOMER",
          },
        });
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: "tax.exemption.backdate_credit",
            entityType: "CustomerCredit",
            entityId: credit.id,
            newValue: {
              customerId, exemptionId: row.id, creditCents,
              validFrom: row.validFrom.toISOString(),
              perInvoice: perInvoice.filter((entry) => entry.cents > 0),
            },
          },
        });
      }
    }
    return row;
  });
}

/**
 * How much of one invoice's tax has already been handed back as a
 * back-dated exemption credit. The refund path subtracts this from what
 * the invoice can still refund: the credit and a later refund must never
 * return the same tax twice. The per-invoice split is recorded on the
 * grant's audit row (back-dated credits are rare — one per late
 * certificate — so reading this customer's grant rows is cheap). Credits
 * granted before per-invoice tracking existed have no split and count 0;
 * none exist outside tests, because the credit itself ships with TFA-2.
 */
export async function exemptionBackdateCreditCentsForInvoiceInTx(
  tx: Pick<Prisma.TransactionClient, "auditLog">,
  customerId: string,
  invoiceId: string,
): Promise<number> {
  const grants = await tx.auditLog.findMany({
    where: { action: "tax.exemption.backdate_credit", entityType: "CustomerCredit" },
    select: { newValue: true },
  });
  let total = 0;
  for (const grant of grants) {
    const value = (grant.newValue ?? {}) as {
      customerId?: string;
      perInvoice?: Array<{ invoiceId?: string; cents?: number }>;
    };
    if (value.customerId !== customerId || !Array.isArray(value.perInvoice)) continue;
    for (const entry of value.perInvoice) {
      if (entry.invoiceId === invoiceId && typeof entry.cents === "number") {
        total += entry.cents;
      }
    }
  }
  return total;
}

export async function updateCustomerTaxExemption(
  actorUserId: string,
  exemptionId: string,
  input: TaxExemptionInput,
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const existing = await lockCustomerTaxExemptionInTx(tx, exemptionId);
    if (existing.revokedAt) {
      throw new Error("A revoked tax exemption cannot be edited. Add a new exemption instead.");
    }
    const data = await exemptionDataInTx(tx, actorUserId, input);
    const row = await tx.customerTaxExemption.update({
      where: { id: exemptionId },
      data,
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "tax.exemption_updated",
        entityType: "CustomerTaxExemption",
        entityId: row.id,
        oldValue: {
          reason: existing.reason,
          jurisdictionIds: existing.jurisdictionIds,
          validFrom: existing.validFrom.toISOString(),
          expiresOn: existing.expiresOn?.toISOString() ?? null,
        },
        newValue: {
          reason: row.reason,
          jurisdictionIds: row.jurisdictionIds,
          validFrom: row.validFrom.toISOString(),
          expiresOn: row.expiresOn?.toISOString() ?? null,
        },
      },
    });
    return row;
  });
}

export async function revokeCustomerTaxExemption(
  actorUserId: string,
  exemptionId: string,
  revokedAt = new Date(),
) {
  if (Number.isNaN(revokedAt.getTime())) {
    throw new Error("Enter a valid exemption revocation date.");
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const existing = await lockCustomerTaxExemptionInTx(tx, exemptionId);
    if (existing.revokedAt) return existing;
    const row = await tx.customerTaxExemption.update({
      where: { id: exemptionId },
      data: { revokedAt },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "tax.exemption_revoked",
        entityType: "CustomerTaxExemption",
        entityId: row.id,
        newValue: {
          customerId: row.customerId,
          revokedAt: row.revokedAt?.toISOString() ?? null,
        },
      },
    });
    return row;
  });
}
