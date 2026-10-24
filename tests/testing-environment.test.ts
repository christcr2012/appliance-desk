import { describe, expect, it } from "vitest";
import { assertTestingDatabaseUrls, assertTestingSeedEnvironment } from "../src/lib/testing-environment";
import { isNonProductionDeployment } from "../src/lib/deployment-safety";

const env = {
  APP_ENV: "testing", TEST_DATA_SEED: "synthetic-only", VERCEL: "1", VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: "test-project", TEST_VERCEL_PROJECT_ID: "test-project",
  TEST_DATABASE_HOST: "ep-example.c-1.us-east-1.aws.neon.tech",
  DATABASE_URL: "postgresql://appliance_desk_testing:fake@ep-example-pooler.c-1.us-east-1.aws.neon.tech/appliance_desk?sslmode=require",
  DIRECT_URL: "postgresql://appliance_desk_testing:fake@ep-example.c-1.us-east-1.aws.neon.tech/appliance_desk?sslmode=require",
};
describe("isolated hosted testing", () => {
  it("treats the dedicated project's production target as nonproduction", () => {
    expect(isNonProductionDeployment(env)).toBe(true);
    expect(() => assertTestingSeedEnvironment(env)).not.toThrow();
  });
  it.each([
    { DATABASE_URL: env.DATABASE_URL.replace("ep-example-pooler", "ep-production") },
    { DIRECT_URL: env.DIRECT_URL.replace("appliance_desk?", "other_db?") },
    { DATABASE_URL: env.DATABASE_URL.replace("appliance_desk_testing:fake", "neondb_owner:fake") },
    { DIRECT_URL: env.DIRECT_URL + "&host=production.example" },
    { VERCEL_PROJECT_ID: "production-project" },
    { TEST_DATABASE_HOST: undefined },
    { DIRECT_URL: undefined },
  ])("refuses mixed targets before a connection or seed", patch => {
    expect(() => assertTestingSeedEnvironment({ ...env, ...patch })).toThrow();
  });
  it("refuses seeding when the application marker or opt-in is absent", () => {
    expect(() => assertTestingSeedEnvironment({ ...env, APP_ENV: "production" })).toThrow();
    expect(() => assertTestingSeedEnvironment({ ...env, TEST_DATA_SEED: undefined })).toThrow();
    expect(() => assertTestingSeedEnvironment({ ...env, STRIPE_SECRET_KEY: "sk_live_fixture" })).toThrow();
    expect(() => assertTestingDatabaseUrls({ ...env, APP_ENV: undefined })).toThrow();
  });
});
