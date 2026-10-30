import { isRateLimited } from "../src/lib/rate-limit";
import { prisma } from "../src/lib/prisma";

/** Two OS processes deliberately compete for the same disposable Postgres bucket. */
const bucket = process.argv[2] ?? "";
if (!bucket.startsWith("rtc-limit-process-fixture-")) process.exit(2);
try {
  const verdicts = await Promise.all(Array.from({ length: 4 }, () =>
    isRateLimited(bucket, { max: 4, windowMs: 60_000 })));
  process.stdout.write(JSON.stringify({ accepted: verdicts.filter(v => !v).length,
    rejected: verdicts.filter(Boolean).length }) + "\n");
} finally {
  await prisma.$disconnect();
}
