import { isRateLimited } from "../src/lib/rate-limit";
import { prisma } from "../src/lib/prisma";

/** Two OS processes deliberately compete for the same disposable Postgres bucket. */
const bucket = process.argv[2] ?? "";
if (!bucket.startsWith("rtc-limit-process-fixture-")) process.exit(2);
async function run() {
  try {
    const verdicts = await Promise.all(Array.from({ length: 4 }, () =>
      isRateLimited(bucket, { max: 4, windowMs: 60_000 })));
    process.stdout.write(JSON.stringify({ accepted: verdicts.filter(v => !v).length,
      rejected: verdicts.filter(Boolean).length }) + "\n");
  } finally {
    await prisma.$disconnect();
  }
}
// The project's default tsx mode compiles CommonJS: top-level await is not supported.
void run().catch((error: unknown) => {
  const safe = String(error instanceof Error ? error.message : "Worker failed")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]").slice(0, 500);
  process.stderr.write("RTC limiter worker: " + safe + "\n");
  process.exitCode = 1;
});
