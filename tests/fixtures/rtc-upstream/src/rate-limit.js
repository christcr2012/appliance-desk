// Distinct independently-started servers with one database must share a real atomic limit.
// Concurrency across both URLs deterministically reveals per-process counters.
export async function verifyTwoInstanceRateLimit({ urls, pass, limit }) {
  if (!Array.isArray(urls) || urls.length !== 2 || urls[0] === urls[1] ||
      !urls.every((u) => /^http:\/\/127\.0\.0\.1:\d+$/.test(u)) ||
      typeof pass !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 600) {
    throw new TypeError('Two distinct localhost URLs, a pass and a limit (1–600) are required');
  }
  const total = limit + Math.max(5, Math.ceil(limit / 2));
  const responses = await Promise.all(Array.from({ length: total }, async (_, i) => {
    const r = await fetch(urls[i % 2] + '/api/whoami', {
      headers: { authorization: 'Bearer ' + pass }, signal: AbortSignal.timeout(10000) });
    return { status: r.status, retry: r.headers.get('retry-after'), body: await r.json() };
  }));
  const successes = responses.filter((x) => x.status === 200 && x.body.ok === true).length;
  const rejections = responses.filter((x) => x.status === 429 &&
    x.body.error?.code === 'rate_limited' && Number(x.retry) > 0).length;
  if (successes !== limit || rejections !== total - limit) {
    throw new Error('§2: shared rate limit: expected ' + limit + ' successes, got ' +
      successes + ' and ' + rejections + ' valid 429 rejections');
  }
  return { successes, limited: rejections };
}
