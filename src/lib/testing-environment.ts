/** Explicit application environment: a testing project can use Vercel's
 * production target without acquiring production business permissions. */
export type TestingEnvironment = Record<string, string | undefined>;

export function isTestingEnvironment(env: TestingEnvironment = process.env): boolean {
  return env.APP_ENV === "testing";
}

/** Check before migrations, runtime connections, and fixture writes. Never
 * print URLs; both the database and role must belong to the empty test DB. */
export function assertTestingDatabaseUrls(env: TestingEnvironment = process.env): void {
  if (!isTestingEnvironment(env)) {
    for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
      let testingRole = false;
      try { testingRole = new URL(env[key] ?? "").username === "appliance_desk_testing"; } catch { /* Other database validation remains in place. */ }
      if (testingRole) throw new Error("The testing database requires APP_ENV=testing.");
    }
    return;
  }
  const host = env.TEST_DATABASE_HOST;
  if (!host || !/^[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(host) || host.includes("-pooler.")) {
    throw new Error("The independently verified testing database host is required.");
  }
  if (env.VERCEL === "1" && (!env.TEST_VERCEL_PROJECT_ID || env.VERCEL_PROJECT_ID !== env.TEST_VERCEL_PROJECT_ID)) {
    throw new Error("Testing configuration is restricted to its verified Vercel project.");
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    let url: URL;
    try { url = new URL(env[key] ?? ""); }
    catch { throw new Error("Testing database credentials are missing or invalid."); }
    const allowed = key === "DIRECT_URL" ? [host] : [host, host.replace(".", "-pooler.")];
    if (!allowed.includes(url.hostname) || url.pathname !== "/appliance_desk" ||
        url.username !== "appliance_desk_testing" || !["postgres:", "postgresql:"].includes(url.protocol) ||
        (url.port && url.port !== "5432") || url.hash ||
        [...url.searchParams.keys()].some(k => ["host", "hostaddr", "port", "database", "dbname", "service", "user", "options"].includes(k.toLowerCase()))) {
      throw new Error("Testing must use its dedicated database, role and verified endpoint.");
    }
  }
}

export function assertTestingSeedEnvironment(env: TestingEnvironment = process.env): void {
  if (!isTestingEnvironment(env) || env.TEST_DATA_SEED !== "synthetic-only") {
    throw new Error("Synthetic seeding is enabled only in the isolated testing environment.");
  }
  assertTestingDatabaseUrls(env);
  if (env.STRIPE_SECRET_KEY && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
    throw new Error("Testing refuses live Stripe credentials.");
  }
}
