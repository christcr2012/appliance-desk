import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPreviewDatabaseUrls } from "@/lib/preview-database-safety";

const directHost = "ep-silent-hill-b7rpraoc.c-13.us-east-1.aws.neon.tech";
const pooledHost =
  "ep-silent-hill-b7rpraoc-pooler.c-13.us-east-1.aws.neon.tech";
const url = (host: string) =>
  `postgresql://test:secret-for-test@${host}/appliance_desk?sslmode=require&channel_binding=require`;
const preview = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  DATABASE_URL: url(pooledHost),
  DIRECT_URL: url(directHost),
};

const constructor = vi.hoisted(() => vi.fn());
vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor() {
      constructor();
    }
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("preview database targets", () => {
  it("accepts verified direct and pooled runtime endpoints", () => {
    expect(() => assertPreviewDatabaseUrls(preview)).not.toThrow();
    expect(() =>
      assertPreviewDatabaseUrls({ ...preview, DATABASE_URL: url(directHost) }),
    ).not.toThrow();
  });
  it.each(["preview", "development", "staging", ""])(
    "enforces targets in %s",
    (VERCEL_ENV) => {
      expect(() =>
        assertPreviewDatabaseUrls({
          ...preview,
          VERCEL_ENV,
          DATABASE_URL: url("production.neon.tech"),
        }),
      ).toThrow("DATABASE_URL");
    },
  );
  it("fails closed for an unknown Vercel environment", () => {
    expect(() =>
      assertPreviewDatabaseUrls({
        ...preview,
        VERCEL_ENV: undefined,
        DIRECT_URL: url("production.neon.tech"),
      }),
    ).toThrow("DIRECT_URL");
  });
  it.each(["DATABASE_URL", "DIRECT_URL"] as const)(
    "rejects missing, invalid and other branch targets for %s",
    (key) => {
      for (const target of [
        undefined,
        "invalid",
        url("ep-example-production-00000000.c-13.us-east-1.aws.neon.tech"),
        url("other.neon.tech"),
      ]) {
        expect(() =>
          assertPreviewDatabaseUrls({ ...preview, [key]: target }),
        ).toThrow(key);
      }
    },
  );
  it("requires an unpooled migration endpoint", () => {
    expect(() =>
      assertPreviewDatabaseUrls({ ...preview, DIRECT_URL: url(pooledHost) }),
    ).toThrow("DIRECT_URL");
  });
  it.each([
    url(pooledHost).replace("postgresql:", "https:"),
    url(pooledHost).replace("/appliance_desk", "/other_database"),
    url(pooledHost).replace(pooledHost, `${pooledHost}:6543`),
    `${url(pooledHost)}&host=production.neon.tech`,
    `${url(pooledHost)}&HOST=production.neon.tech`,
    `${url(pooledHost)}&hostaddr=127.0.0.1`,
    `${url(pooledHost)}&dbname=other_database`,
    `${url(pooledHost)}&database=other_database`,
    `${url(pooledHost)}&port=6543`,
    `${url(pooledHost)}&service=production`,
    `${url(pooledHost)}#ignored-fragment`,
  ])(
    "rejects alternate protocol, database, port or override parameters (%#)",
    (DATABASE_URL) => {
      expect(() =>
        assertPreviewDatabaseUrls({ ...preview, DATABASE_URL }),
      ).toThrow("DATABASE_URL");
    },
  );
  it("does not include credentials or connection strings in errors", () => {
    try {
      assertPreviewDatabaseUrls({
        ...preview,
        DATABASE_URL: url("production.neon.tech"),
      });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(String(error)).not.toContain("secret-for-test");
      expect(String(error)).not.toContain("postgresql://");
    }
  });
  it("preserves production and local/CI targets", () => {
    expect(() =>
      assertPreviewDatabaseUrls({
        VERCEL_ENV: "production",
        DATABASE_URL: url("production.neon.tech"),
      }),
    ).not.toThrow();
    expect(() =>
      assertPreviewDatabaseUrls({
        DATABASE_URL: "postgresql://test:test@localhost/test",
      }),
    ).not.toThrow();
  });
  it("blocks runtime client construction before connecting to an unsafe target", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("DATABASE_URL", url("production.neon.tech"));
    vi.stubEnv("DIRECT_URL", url(directHost));
    await expect(import("@/lib/prisma")).rejects.toThrow("DATABASE_URL");
    expect(constructor).not.toHaveBeenCalled();
  });
});
