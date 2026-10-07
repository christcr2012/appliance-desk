import { businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import {
  hasAutomaticColoradoRateSource,
} from "./colorado-gis";
import { locateServiceAddress } from "./locations";

export const TAX_ADDRESS_CHANGE_REVIEW_NOTE =
  "Automatic tax-area re-check found different jurisdictions. Review and confirm the address before relying on the new tax areas.";

export function shouldRunMonthlyTaxAddressRecheck(now = new Date()): boolean {
  return businessDateKey(now).endsWith("-01");
}

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function recheckCurrentTaxAddresses(
  now = new Date(),
  options: { serviceAddressIds?: string[] } = {},
): Promise<{
  due: boolean;
  automaticSourceAvailable: boolean;
  checked: number;
  changed: number;
  needsReview: number;
}> {
  if (!shouldRunMonthlyTaxAddressRecheck(now)) {
    return {
      due: false,
      automaticSourceAvailable: hasAutomaticColoradoRateSource(),
      checked: 0,
      changed: 0,
      needsReview: 0,
    };
  }

  if (!hasAutomaticColoradoRateSource()) {
    return {
      due: true,
      automaticSourceAvailable: false,
      checked: 0,
      changed: 0,
      needsReview: 0,
    };
  }

  const current = await prisma.addressTaxLocation.findMany({
    where: {
      isCurrent: true,
      serviceAddressId: options.serviceAddressIds?.length
        ? { in: options.serviceAddressIds }
        : { not: null },
    },
    select: {
      serviceAddressId: true,
      jurisdictions: { select: { jurisdictionId: true } },
    },
    orderBy: { serviceAddressId: "asc" },
  });

  let checked = 0;
  let changed = 0;
  let needsReview = 0;

  for (const row of current) {
    if (!row.serviceAddressId) continue;
    const beforeIds = row.jurisdictions.map((item) => item.jurisdictionId);

    const result = await locateServiceAddress(row.serviceAddressId, {
      force: true,
    });
    checked += 1;

    const after = await prisma.addressTaxLocation.findFirst({
      where: {
        serviceAddressId: row.serviceAddressId,
        isCurrent: true,
      },
      select: {
        id: true,
        status: true,
        jurisdictions: { select: { jurisdictionId: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (!after) {
      needsReview += 1;
      continue;
    }

    const afterIds = after.jurisdictions.map((item) => item.jurisdictionId);
    if (!sameIds(beforeIds, afterIds)) {
      await prisma.$transaction(async (tx) => {
        await tx.addressTaxLocation.update({
          where: { id: after.id },
          data: {
            status: "NEEDS_REVIEW",
            reviewNote: TAX_ADDRESS_CHANGE_REVIEW_NOTE,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: null,
            action: "tax.address_recheck_changed",
            entityType: "ServiceAddress",
            entityId: row.serviceAddressId!,
            oldValue: { jurisdictionIds: sorted(beforeIds) },
            newValue: { jurisdictionIds: sorted(afterIds) },
          },
        });
      });
      changed += 1;
      needsReview += 1;
      continue;
    }

    if (result.status !== "VERIFIED") needsReview += 1;
  }

  return {
    due: true,
    automaticSourceAvailable: true,
    checked,
    changed,
    needsReview,
  };
}
