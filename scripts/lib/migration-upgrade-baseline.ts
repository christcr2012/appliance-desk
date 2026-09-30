import { cp, writeFile } from "node:fs/promises";
import path from "node:path";

export const UPGRADE_BASELINE = "20260926150000_init";

/** Use the real historical SQL, independent of untracked local Prisma files. */
export async function prepareUpgradeBaseline(
  root: string,
  destination: string,
) {
  await cp(
    path.join(root, "prisma/migrations", UPGRADE_BASELINE),
    path.join(destination, UPGRADE_BASELINE),
    { recursive: true },
  );
  await writeFile(
    path.join(destination, "migration_lock.toml"),
    'provider = "postgresql"\n',
  );
}
