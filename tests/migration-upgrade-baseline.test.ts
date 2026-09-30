// Real filesystem test: no mocked copy/write, no dependency on a local lock file.
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  prepareUpgradeBaseline,
  UPGRADE_BASELINE,
} from "../scripts/lib/migration-upgrade-baseline";

it("prepares only the tracked historical migration with a PostgreSQL lock", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "upgrade-baseline-test-"));
  try {
    const destination = path.join(temp, "migrations");
    await prepareUpgradeBaseline(process.cwd(), destination);
    expect((await readdir(destination)).sort()).toEqual([
      UPGRADE_BASELINE,
      "migration_lock.toml",
    ]);
    const original = await readFile(
      path.join(
        process.cwd(),
        "prisma/migrations",
        UPGRADE_BASELINE,
        "migration.sql",
      ),
      "utf8",
    );
    expect(
      await readFile(
        path.join(destination, UPGRADE_BASELINE, "migration.sql"),
        "utf8",
      ),
    ).toBe(original);
    expect(
      await readFile(path.join(destination, "migration_lock.toml"), "utf8"),
    ).toBe('provider = "postgresql"\n');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
