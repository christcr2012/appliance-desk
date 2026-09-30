/** This drill may only create/drop its own database in CI's disposable Postgres. */
export function migrationUpgradeTarget(env: {
  CI?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  DIRECT_URL?: string;
  DATABASE_URL?: string;
}): URL {
  if (env.CI !== "true" || env.VERCEL || env.VERCEL_ENV) {
    throw new Error(
      "Migration upgrade drill requires disposable CI, never Vercel.",
    );
  }
  let target: URL;
  try {
    target = new URL(env.DIRECT_URL ?? "");
  } catch {
    throw new Error(
      "Migration upgrade drill requires the CI localhost target.",
    );
  }
  if (
    target.protocol !== "postgresql:" ||
    target.hostname !== "localhost" ||
    target.port !== "5432" ||
    target.pathname !== "/appliance_desk_test" ||
    target.username !== "test" ||
    target.password !== "test" ||
    target.search ||
    target.hash ||
    env.DATABASE_URL !== env.DIRECT_URL
  ) {
    throw new Error(
      "Migration upgrade drill requires matching CI localhost test URLs.",
    );
  }
  return target;
}
