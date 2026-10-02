import { spawnSync } from "node:child_process";
import { Client } from "pg";

const LEGACY_NAME = "20261003000000_batch_b_ledger";
const CANONICAL_NAME = "20261002180000_batch_b_ledger";
const EXPECTED_CHECKSUM = "9cbe5ddd2ee2a6a796300ca0df068a2d9861e01817f454e9ec0b1bb770a91b36";
const PREVIEW_DIRECT_HOST = "ep-silent-hill-b7rpraoc.c-13.us-east-1.aws.neon.tech";
const PREVIEW_DATABASE = "appliance_desk";

function fail(message) {
  throw new Error(`[preview-migration-repair] ${message}`);
}

function assertVerifiedPreviewTarget() {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "preview") {
    return false;
  }

  let target;
  try {
    target = new URL(process.env.DIRECT_URL ?? "");
  } catch {
    fail("DIRECT_URL is missing or invalid.");
  }

  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== PREVIEW_DIRECT_HOST ||
    target.pathname !== `/${PREVIEW_DATABASE}`
  ) {
    fail("Refusing to repair migration history outside the verified preview database.");
  }

  return true;
}

async function loadRows() {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT migration_name, checksum, applied_steps_count, finished_at, rolled_back_at
       FROM "_prisma_migrations"
       WHERE migration_name = ANY($1::text[])
       ORDER BY started_at`,
      [[LEGACY_NAME, CANONICAL_NAME]],
    );
    return rows;
  } finally {
    await client.end();
  }
}

if (!assertVerifiedPreviewTarget()) {
  console.log("[preview-migration-repair] Not a Vercel preview deployment; skipping.");
  process.exit(0);
}

const rows = await loadRows();
const legacy = rows.find((row) => row.migration_name === LEGACY_NAME);
const canonicalApplied = rows.find(
  (row) => row.migration_name === CANONICAL_NAME && row.finished_at && !row.rolled_back_at,
);

if (canonicalApplied) {
  if (canonicalApplied.checksum !== EXPECTED_CHECKSUM) {
    fail("Canonical Batch B migration is applied with an unexpected checksum.");
  }
  console.log("[preview-migration-repair] Canonical Batch B migration is already applied; nothing to do.");
  process.exit(0);
}

const canonicalFailed = rows.find(
  (row) => row.migration_name === CANONICAL_NAME && !row.finished_at && !row.rolled_back_at,
);

if (
  !legacy?.finished_at ||
  legacy.rolled_back_at ||
  legacy.checksum !== EXPECTED_CHECKSUM ||
  Number(legacy.applied_steps_count) !== 1 ||
  !canonicalFailed ||
  canonicalFailed.checksum !== EXPECTED_CHECKSUM ||
  Number(canonicalFailed.applied_steps_count) !== 0
) {
  fail("Migration history does not match the one known-safe renamed-migration recovery case.");
}

console.log(
  `[preview-migration-repair] Resolving ${CANONICAL_NAME} as applied; identical schema was already applied under ${LEGACY_NAME}.`,
);
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  command,
  ["prisma", "migrate", "resolve", "--applied", CANONICAL_NAME],
  { stdio: "inherit", env: process.env },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  fail(`Prisma migrate resolve exited with status ${result.status ?? "unknown"}.`);
}

const verifiedRows = await loadRows();
const verifiedCanonical = verifiedRows.find(
  (row) => row.migration_name === CANONICAL_NAME && row.finished_at && !row.rolled_back_at,
);
if (!verifiedCanonical || verifiedCanonical.checksum !== EXPECTED_CHECKSUM) {
  fail("Prisma reported success but the canonical migration is still not marked applied.");
}
console.log("[preview-migration-repair] Migration history repaired successfully.");
