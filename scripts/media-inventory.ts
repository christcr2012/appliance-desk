// Backward-compatible CLI and import surface; all app-used media logic lives in the domain.
export {
  findLatestDatabaseBackupUrl,
  runMediaInventoryAndCopy,
  restoreMediaFromManifest,
  verifyMediaRecoverySample,
} from "../src/domains/backup/media";
export type { MediaManifestEntry, MediaRecoveryManifest } from "../src/domains/backup/media";
import { restoreMediaFromManifest, verifyMediaRecoverySample } from "../src/domains/backup/media";

async function cli(): Promise<void> {
  const [command, manifestUrl, extra] = process.argv.slice(2);
  if (!manifestUrl || !["verify", "restore"].includes(command ?? "")) {
    throw new Error(
      "Usage: npx tsx scripts/media-inventory.ts <verify|restore> <media-manifest-url> [sample-count-for-verify]",
    );
  }

  if (command === "restore") {
    if (extra !== undefined) throw new Error("The restore command does not accept a sample count.");
    const result = await restoreMediaFromManifest(manifestUrl);
    console.log(
      `Media restore passed (${result.restored} restored, ${result.alreadyPresent} already present, ${result.skippedTombstoned} privacy-tombstoned skipped).`,
    );
    return;
  }

  const sampleSize = extra === undefined ? 3 : Number(extra);
  if (!Number.isInteger(sampleSize) || sampleSize < 0) {
    throw new Error("sample-count must be a non-negative integer.");
  }

  const result = await verifyMediaRecoverySample(manifestUrl, sampleSize);
  console.log(
    `Media recovery verification passed (${result.checked} checked, ${result.skippedTombstoned} tombstoned skipped).`,
  );
}

if (process.argv[1]?.endsWith("media-inventory.ts")) {
  cli().catch((error) => {
    console.error(
      "[media-recovery] FAILED:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}
