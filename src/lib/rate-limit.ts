/**
 * A minimal, zero-infrastructure rate limiter for public forms (Phase
 * 6A item 7 — spam/abuse protection). Keeps a sliding window of recent
 * submission timestamps per key (typically an IP address) in memory.
 *
 * Honest limitation, on purpose: Vercel can run multiple serverless
 * instances of the same route, each with its own memory, so this is
 * "best effort" — it won't catch a determined attacker spreading
 * requests across instances or IPs. It's still real, meaningful
 * protection against the common case (a script hammering the endpoint
 * from one IP) with no new paid service, no schema change, and nothing
 * for Chris to set up. If abuse becomes a real problem in practice, the
 * next real upgrade is a persistent store (see docs/DECISIONS.md) or
 * Cloudflare Turnstile (docs/ROADMAP.md) — not something to build
 * speculatively before there's evidence it's needed.
 */

const buckets = new Map<string, number[]>();

/** Returns true if `key` is allowed one more request within the last
 * `windowMs` milliseconds, given at most `max` requests are allowed in
 * that window — and records this request if so. */
export function isRateLimited(
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (buckets.get(key) ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= max) {
    buckets.set(key, timestamps);
    return true;
  }

  timestamps.push(now);
  buckets.set(key, timestamps);

  // Cheap, occasional cleanup so this Map never grows unbounded across
  // a long-lived serverless instance's lifetime.
  if (buckets.size > 5000) {
    for (const [k, ts] of buckets) {
      const kept = ts.filter((t) => t > cutoff);
      if (kept.length === 0) buckets.delete(k);
      else buckets.set(k, kept);
    }
  }

  return false;
}
