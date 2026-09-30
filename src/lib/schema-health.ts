import { Prisma, type PrismaClient } from "@prisma/client";

type ModelClient = Pick<PrismaClient, Uncapitalize<Prisma.ModelName>>;

/** Read every model's scalar columns, including empty tables. Postgres checks
 * the query's columns even when there are no rows. No relations or writes are
 * needed, and each query returns at most one record. Generated model names
 * automatically include future schema additions. */
export async function verifySchemaHealth(client: ModelClient): Promise<void> {
  for (const model of Object.values(Prisma.ModelName)) {
    const delegate = (model[0]!.toLowerCase() + model.slice(1)) as Uncapitalize<Prisma.ModelName>;
    try {
      await (client[delegate] as { findFirst: () => Promise<unknown> }).findFirst();
    } catch (cause) {
      throw new Error(`Schema health check failed for ${model}. Check its table, columns and applied migrations.`, { cause });
    }
  }
}
