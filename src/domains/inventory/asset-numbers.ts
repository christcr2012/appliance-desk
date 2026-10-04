import type { Prisma } from "@prisma/client";

/** Pure — formats a prefix + sequence into an asset number, e.g. ("WASH", 3) -> "WASH-0003". */
export function buildAssetNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

const MAX_SEQUENCE = 999_999_999;

/**
 * Hand out `count` new asset numbers for `prefix` (spec P1-B). Never reuses a number: a per-prefix
 * counter only moves forward, so a gap left by a removed unit stays a gap.
 *
 * The counter row is created first (seeded from the highest existing number for the prefix) and
 * then locked, because selecting a row that does not exist locks nothing. Numbers already taken
 * (hand-made ones the seed pattern could not see) are skipped. Must run inside the transaction that
 * creates the units, so the counter and the units commit or roll back together.
 */
export async function allocateAssetNumbers(
  tx: Prisma.TransactionClient,
  prefix: string,
  count: number,
): Promise<string[]> {
  if (!/^[A-Z0-9]{1,6}$/.test(prefix)) throw new Error("That appliance category cannot be given asset numbers.");
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("Add between 1 and 50 units at a time.");

  const seedPattern = `^${prefix}-([0-9]{1,9})$`;
  await tx.$executeRaw`
    INSERT INTO "AssetNumberCounter" ("prefix", "nextSequence", "updatedAt")
    SELECT ${prefix}, COALESCE(MAX(CAST(substring("assetNumber" from ${seedPattern}) AS INTEGER)), 0) + 1, NOW()
    FROM "Appliance"
    WHERE "assetNumber" ~ ${seedPattern}
    ON CONFLICT ("prefix") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ nextSequence: number }>>`
    SELECT "nextSequence" FROM "AssetNumberCounter" WHERE "prefix" = ${prefix} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("Couldn't reserve asset numbers. Try again.");

  let next = rows[0].nextSequence;
  const numbers: string[] = [];
  while (numbers.length < count) {
    if (next > MAX_SEQUENCE) throw new Error("This appliance category has run out of asset numbers.");
    const candidate = buildAssetNumber(prefix, next);
    next += 1;
    const taken = await tx.appliance.findUnique({ where: { assetNumber: candidate }, select: { id: true } });
    if (!taken) numbers.push(candidate);
  }
  await tx.$executeRaw`
    UPDATE "AssetNumberCounter" SET "nextSequence" = ${next}, "updatedAt" = NOW() WHERE "prefix" = ${prefix}
  `;
  return numbers;
}
