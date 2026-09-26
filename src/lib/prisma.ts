import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import ws from "ws";

// Reuse a single Prisma Client across hot reloads in dev, and across
// serverless invocations on Vercel where the module cache persists.
// See docs/ARCHITECTURE.md for why we connect through Neon's pooled
// endpoint (DATABASE_URL) for normal queries and the direct endpoint
// (DIRECT_URL) only for migrations (that one lives in prisma.config.ts,
// not here).
//
// Prisma 7 no longer accepts a `url` in schema.prisma — the app now hands
// PrismaClient its own connection via a "driver adapter". Real production
// (and every Vercel preview) points DATABASE_URL at Neon, so it uses
// Neon's own serverless driver (talks to Postgres over a WebSocket,
// which is why this needs the `ws` package on Vercel's Node.js runtime).
// CI and local development, though, run a real *plain* Postgres
// container (see .github/workflows/ci.yml) — not Neon — and Neon's
// WebSocket protocol only works against Neon's own infrastructure, not a
// vanilla Postgres. So: use the Neon adapter only when DATABASE_URL is
// actually a Neon host, and a standard TCP adapter (@prisma/adapter-pg)
// otherwise. This was found the hard way — CI's seed step and the
// lead-form e2e test are the first things to run a real query against a
// non-Neon Postgres — see docs/DECISIONS.md.
neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — see .env.example.");
  }

  const isNeon = connectionString.includes(".neon.tech");
  const adapter = isNeon
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
