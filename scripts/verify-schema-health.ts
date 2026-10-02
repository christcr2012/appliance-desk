// Safe production database migrations (Phase 6A item 1) — see
// docs/DECISIONS.md's dated design entry.
//
// Runs right after `prisma migrate deploy` and right before `next build`
// (see the "vercel-build" script in package.json). Its only job is to
// prove — with one real query per model in the schema — that the
// database this deploy is about to build the app against actually
// matches what the app's code expects, and to fail with a clear,
// plain-English message if it doesn't.
//
// This exact failure mode already happened once for real: a Vercel
// build's static prerendering of "/" crashed deep inside
// src/domains/settings/index.ts with a cryptic Prisma error ("column...
// does not exist") because the database hadn't been migrated yet before
// the build ran (see docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md). Catching the same problem here,
// first, with a message that says plainly what's wrong, is much easier
// for a non-developer (or the next AI session) to act on than a
// stack trace buried inside Next.js's own build output.
import { prisma } from "../src/lib/prisma";
import { verifySchemaHealth } from "../src/lib/schema-health";

async function main() {
  console.log(
    "[migrate] Checking the database matches what this version of the app expects...",
  );

  // Cover every generated model, including authentication tables and new
  // features. A limited read still validates scalar columns in empty tables.
  await prisma.$queryRaw`SELECT 1`;
  await verifySchemaHealth(prisma);

  console.log("[migrate] Schema health check passed.");
}

main()
  .catch((error) => {
    console.error(
      "\n[migrate] SCHEMA HEALTH CHECK FAILED — stopping the deploy here on purpose.\n" +
        "The database does not match what this version of the app expects (a table, column, or " +
        "type is missing or different from what the code needs). This almost always means a " +
        "migration wasn't actually applied, or only partially applied. The deploy is being stopped " +
        "at this step, before the app is built or goes live, so the site keeps running its last " +
        "working version for real customers instead of breaking. See docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md and " +
        'docs/DECISIONS.md\'s "Safe production database migrations" entry for what to check next.\n',
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
