#!/usr/bin/env node
// Safe production database migrations (Phase 6A item 1) — see
// docs/DECISIONS.md's dated design entry for the full writeup.
//
// Scans every migration for SQL patterns that can destroy or corrupt
// real data (dropping a table/column, truncating, renaming, or forcing
// an existing column to NOT NULL) and refuses to let one through
// un-reviewed. This never touches or rewrites a migration.sql file —
// editing an already-applied migration's SQL after the fact would
// break Prisma's own checksum check against production (a real risk,
// not a theoretical one) — so approval is recorded separately, in
// prisma/migrations/DESTRUCTIVE-MIGRATIONS-REVIEWED.json.
//
// Runs in two places: as its own CI step on every pull request (so a
// human reviewer sees the block before merge), and again at the start
// of the production build ("vercel-build" in package.json) as a
// last-resort safety net in case something slipped through review.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = join(rootDir, "prisma", "migrations");
const reviewedPath = join(migrationsDir, "DESTRUCTIVE-MIGRATIONS-REVIEWED.json");

const DESTRUCTIVE_PATTERNS = [
  { name: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  { name: "DROP DATABASE", re: /\bDROP\s+DATABASE\b/i },
  { name: "TRUNCATE", re: /\bTRUNCATE\b/i },
  { name: "RENAME COLUMN or TABLE (breaks anything still reading the old name)", re: /\bRENAME\s+(COLUMN|TO)\b/i },
  {
    name: "SET NOT NULL on an existing column (fails or corrupts rows with a real NULL already in them)",
    re: /\bSET\s+NOT\s+NULL\b/i,
  },
];

function loadReviewed() {
  try {
    return JSON.parse(readFileSync(reviewedPath, "utf8"));
  } catch {
    return {};
  }
}

function main() {
  const reviewed = loadReviewed();
  const entries = readdirSync(migrationsDir, { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  );

  let hasUnreviewedDestructive = false;

  for (const entry of entries) {
    const migrationSqlPath = join(migrationsDir, entry.name, "migration.sql");
    let sql;
    try {
      sql = readFileSync(migrationSqlPath, "utf8");
    } catch {
      continue;
    }

    const matches = DESTRUCTIVE_PATTERNS.filter((p) => p.re.test(sql));
    if (matches.length === 0) continue;

    const note = reviewed[entry.name];
    if (note) {
      console.log(
        `[migration-safety] ${entry.name}: contains ${matches
          .map((m) => m.name)
          .join(", ")} — already reviewed ("${note}").`,
      );
      continue;
    }

    hasUnreviewedDestructive = true;
    console.error(
      `\n[migration-safety] BLOCKED: "${entry.name}" contains a potentially destructive change:\n` +
        matches.map((m) => `  - ${m.name}`).join("\n") +
        `\n\nThis needs Chris's explicit, recorded sign-off before it can reach a real database ` +
        `(see docs/BUSINESS-RULES.md's data-safety expectations and docs/DECISIONS.md's "Safe ` +
        `production database migrations" entry). Once Chris has confirmed it's safe — e.g. no real ` +
        `rows are affected, or he's approved the data loss — add an entry for "${entry.name}" to ` +
        `prisma/migrations/DESTRUCTIVE-MIGRATIONS-REVIEWED.json explaining what was confirmed, then re-run.\n`,
    );
  }

  if (hasUnreviewedDestructive) {
    process.exit(1);
  }
  console.log("[migration-safety] No unreviewed destructive migrations found.");
}

main();
