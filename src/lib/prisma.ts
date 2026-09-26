import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
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
// PrismaClient its own connection via a "driver adapter". We use Neon's
// serverless driver, which talks to Postgres over a WebSocket. This app
// runs on Vercel's Node.js runtime (not the browser or the edge runtime),
// so it needs the `ws` package to open that WebSocket connection.
neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — see .env.example.");
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
