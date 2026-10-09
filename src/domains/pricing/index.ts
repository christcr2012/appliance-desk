import { prisma } from "@/lib/prisma";
import { cache } from "react";
import { packageContents, packageSaving } from "@/domains/packages/pricing";

// dollarsToCents/formatCents live in ./money (no database import) so
// client components can import them without pulling @/lib/prisma (and
// the `pg` driver underneath it) into the browser bundle — see that
// file's comment. Re-exported here so every existing SERVER-side import
// of these from "@/domains/pricing" keeps working unchanged.
export { dollarsToCents, formatCents } from "./money";

/**
 * Every published appliance type shown on the public site, ordered the
 * way Chris configured them in /desk/settings. Only rows with
 * showOnWebsite=true are ever shown publicly — see
 * docs/BUSINESS-RULES.md ("new appliance categories are added as data").
 */
export const getPublishedApplianceTypes = cache(async () => {
  return prisma.applianceType.findMany({
    where: { showOnWebsite: true, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
});

export type CatalogItem = {
  kind: "package" | "type";
  id: string;
  name: string;
  slug: string;
  monthlyPriceCents: number;
  photoUrl: string | null;
  /** Packages only: "Washer + Dryer". */
  contents?: string;
  /** Packages only: what the customer saves a month versus renting the machines separately (0 when none). */
  savingCents?: number;
};

/**
 * What the public site offers: published sets first (Batch W Amendment B, D-WB3), then published single machines,
 * each in the owner's order. A set is only offered while every machine in it is an active type.
 */
export const getPublishedCatalog = cache(async (): Promise<CatalogItem[]> => {
  const [packages, types] = await Promise.all([
    prisma.rentalPackage.findMany({
      where: { showOnWebsite: true, isActive: true, components: { some: {}, every: { applianceType: { isActive: true } } } },
      include: { components: { include: { applianceType: true }, orderBy: { applianceType: { sortOrder: "asc" } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    getPublishedApplianceTypes(),
  ]);
  return [
    ...packages.map((p) => {
      const parts = p.components.map((c) => ({
        quantity: c.quantity,
        name: c.applianceType.name,
        monthlyPriceCents: c.applianceType.monthlyPriceCents,
      }));
      return {
        kind: "package" as const,
        id: p.id,
        name: p.name,
        slug: p.slug,
        monthlyPriceCents: p.monthlyPriceCents,
        photoUrl: p.photoUrl,
        contents: packageContents(parts),
        savingCents: Math.max(0, packageSaving(p.monthlyPriceCents, parts).savingCents),
      };
    }),
    ...types.map((t) => ({
      kind: "type" as const,
      id: t.id,
      name: t.name,
      slug: t.slug,
      monthlyPriceCents: t.monthlyPriceCents,
      photoUrl: t.photoUrl,
    })),
  ];
});
