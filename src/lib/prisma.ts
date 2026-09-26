import { PrismaClient } from "@prisma/client";

// Reuse a single Prisma Client across hot reloads in dev, and across
// serverless invocations on Vercel where the module cache persists.
// See docs/ARCHITECTURE.md for why we connect through Neon's pooled
// endpoint (DATABASE_URL) for normal queries and the direct endpoint
// (DIRECT_URL) only for migrations.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
