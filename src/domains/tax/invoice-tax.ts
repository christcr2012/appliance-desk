import type { Prisma } from "@prisma/client";

import { computeTax, type EngineResult } from "@/domains/tax/engine";
import { getAgreementTaxContext } from "@/domains/tax/locations";
import type { InvoiceLineItemKind } from "@/domains/tax/categories";

export type AgreementInvoiceTaxLine = {
  key: string;
  kind: InvoiceLineItemKind;
  amountCents: number;
  parentKey?: string;
};

export async function computeAgreementInvoiceTax(
  tx: Prisma.TransactionClient,
  input: {
    agreementId: string;
    taxDate: Date;
    lines: AgreementInvoiceTaxLine[];
  },
): Promise<EngineResult> {
  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: input.agreementId },
    select: { serviceAddressId: true },
  });
  const location = await tx.addressTaxLocation.findFirst({
    where: {
      serviceAddressId: agreement.serviceAddressId,
      isCurrent: true,
    },
    select: {
      status: true,
      jurisdictions: {
        select: {
          jurisdiction: {
            select: { name: true, reviewStatus: true },
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const problems = new Set<string>();
  if (!location || location.status !== "VERIFIED") {
    problems.add("Confirm the tax areas for this service address before sending this bill.");
  }
  if (location?.status === "VERIFIED" && location.jurisdictions.length === 0) {
    problems.add("Choose at least one tax area for this service address before sending this bill.");
  }
  for (const row of location?.jurisdictions ?? []) {
    if (row.jurisdiction.reviewStatus !== "REVIEWED") {
      problems.add(`Review ${row.jurisdiction.name} before sending this bill.`);
    }
  }

  const context = await getAgreementTaxContext(
    tx,
    input.agreementId,
    input.taxDate,
  );
  const computed = computeTax({ ...context, lines: input.lines });
  if (!computed.ok) {
    for (const problem of computed.problems) problems.add(problem);
  }

  return problems.size > 0
    ? { ok: false, problems: [...problems] }
    : computed;
}
