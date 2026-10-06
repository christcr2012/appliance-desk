import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  __setBackupReadHookForTests,
  buildDatabaseBackupSnapshot,
} from "@/domains/backup";

const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const enabled =
  process.env.CI === "true" &&
  parsed !== null &&
  ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
  parsed.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("backup snapshot consistency (real Postgres)", () => {
  const marker = \`F1-\${process.pid}-snapshot\`;

  afterEach(async () => {
    __setBackupReadHookForTests(null);
    await prisma.assetNumberCounter.deleteMany({ where: { prefix: marker } });
  });

  it("records restore metadata and excludes a row committed after the snapshot began", async () => {
    const previousSha = process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.VERCEL_GIT_COMMIT_SHA = "f1-test-sha";
    let inserted = false;
    __setBackupReadHookForTests(async () => {
      if (inserted) return;
      inserted = true;
      await prisma.assetNumberCounter.create({
        data: { prefix: marker, nextSequence: 901 },
      });
    });

    try {
      const snapshot = await buildDatabaseBackupSnapshot();
      const migration = await prisma.$queryRaw<Array<{ migration_name: string }>>\`
        SELECT "migration_name"
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
        ORDER BY "finished_at" DESC, "started_at" DESC
        LIMIT 1
      \`;

      expect(snapshot.payload.formatVersion).toBe(2);
      expect(snapshot.payload.migrationId).toBe(migration[0]?.migration_name);
      expect(snapshot.payload.appVersion).toBe("f1-test-sha");
      expect(new Date(snapshot.payload.exportedAt).toString()).not.toBe("Invalid Date");
      expect(
        snapshot.payload.tables.assetNumberCounter.some(
          (row) => (row as { prefix?: string }).prefix === marker,
        ),
      ).toBe(false);
      expect(await prisma.assetNumberCounter.findUnique({ where: { prefix: marker } })).not.toBeNull();
    } finally {
      if (previousSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = previousSha;
    }
  });
});
