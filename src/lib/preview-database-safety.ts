import { isNonProductionDeployment } from "./deployment-safety";

// Non-secret identities verified through Neon on 2026-09-30:
// appliance-desk project jolly-term-08991992, vercel-preview-2 branch
// br-broad-union-b784qy62, endpoint ep-silent-hill-b7rpraoc.
// Endpoint changes require verifying the replacement branch before updating.
const PREVIEW_DIRECT_HOST =
  "ep-silent-hill-b7rpraoc.c-13.us-east-1.aws.neon.tech";
const PREVIEW_POOLED_HOST =
  "ep-silent-hill-b7rpraoc-pooler.c-13.us-east-1.aws.neon.tech";

type DatabaseEnvironment = {
  VERCEL?: string;
  VERCEL_ENV?: string;
  DATABASE_URL?: string;
  DIRECT_URL?: string;
};

/** Check both migration and runtime targets before creating a connection.
 * Error messages never include connection strings or credentials. */
export function assertPreviewDatabaseUrls(
  env: DatabaseEnvironment = {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  },
): void {
  if (!isNonProductionDeployment(env)) return;

  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    let target: URL;
    try {
      target = new URL(env[key] ?? "");
    } catch {
      throw new Error(
        `${key} must identify the verified preview database. Missing or invalid URLs are refused.`,
      );
    }
    const allowedHosts =
      key === "DIRECT_URL"
        ? [PREVIEW_DIRECT_HOST]
        : [PREVIEW_DIRECT_HOST, PREVIEW_POOLED_HOST];
    // Some Postgres URL parsers allow query parameters to override the host,
    // port or database from the authority/path. Reject those alternate targets.
    const hasTargetOverride = [...target.searchParams.keys()].some((name) =>
      ["host", "hostaddr", "port", "database", "dbname", "service"].includes(
        name.toLowerCase(),
      ),
    );
    if (
      !["postgres:", "postgresql:"].includes(target.protocol) ||
      !allowedHosts.includes(target.hostname) ||
      target.pathname !== "/appliance_desk" ||
      (target.port !== "" && target.port !== "5432") ||
      target.hash ||
      hasTargetOverride
    ) {
      throw new Error(
        `${key} must use the verified preview database endpoint. Production and unverified targets are refused.`,
      );
    }
  }
}
