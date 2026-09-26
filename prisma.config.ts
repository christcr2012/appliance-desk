// Prisma 7 configuration file. As of Prisma 7, connection strings for
// Migrate/Studio/introspection can no longer live in schema.prisma's
// `datasource` block — they're configured here instead. This does NOT
// affect the running app: src/lib/prisma.ts passes its own connection to
// the PrismaClient constructor via a driver adapter, independent of this
// file. See docs/DECISIONS.md for why.
//
// DIRECT_URL is Neon's unpooled connection string — Migrate needs a
// session-level (non-pgbouncer) connection to run schema changes safely.
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
