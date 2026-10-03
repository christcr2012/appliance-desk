import { describe, expect, it } from "vitest";
import { scanPath, scanText } from "../scripts/check-secrets.mjs";

// Realistic-looking values are assembled at run time so this file itself never
// contains something the scanner (or gitleaks) would flag.
const join = (...parts: string[]) => parts.join("");
const names = (file: string, text: string) => scanText(file, text).map((f: { rule: string }) => f.rule);

describe("check-secrets: what must fail the build in a public repository", () => {
  it("flags a live Stripe key, a webhook secret and a real-length test key", () => {
    expect(names("a.ts", `const k = "${join("sk_", "live_", "A1b2C3d4E5f6G7h8I9j0K1l2")}";`)).toContain("Stripe live key");
    expect(names("a.ts", `x = ${join("whsec", "_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4")}`)).toContain("Stripe webhook secret");
    expect(names("a.ts", `x = ${join("sk_", "test_", "A1b2C3d4E5f6G7h8I9j0K1l2M3")}`)).toContain("Stripe test secret key (real length)");
  });

  it("flags GitHub, AWS, Google, Slack and private-key material", () => {
    expect(names("a", join("ghp", "_", "a".repeat(36)))).toContain("GitHub token");
    expect(names("a", join("AKIA", "ABCDEFGHIJKLMNOP"))).toContain("AWS access key");
    expect(names("a", join("AIza", "SyA".repeat(10 + 1)))).toContain("Google API key");
    expect(names("a", join("xoxb", "-", "1234567890-abcdef"))).toContain("Slack token");
    expect(names("a", join("-----BEGIN ", "PRIVATE KEY-----"))).toContain("Private key block");
  });

  it("flags a database URL with a password that points at a real host, but not the local throwaway database", () => {
    const real = join("postgresql://app:", "s3cretpass", "@db.some-host.example-corp.io/app");
    expect(names("a", `DATABASE_URL=${real}`.replace("example-corp", "corp"))).toContain(
      "Database URL with an embedded password (not the local throwaway database)",
    );
    expect(scanText("a", "DATABASE_URL=postgresql://test:test@localhost:5432/appliance_desk_test")).toEqual([]);
    expect(scanText("a", "DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/x")).toEqual([]);
  });

  it("flags Neon/Vercel identifiers that are not the allowed preview ones", () => {
    expect(names("a", join("br-", "quiet-river-", "abc12345"))).toContain("Neon/Vercel infrastructure identifier");
    expect(names("a", join("ep-", "quiet-river-", "abc12345"))).toContain("Neon/Vercel infrastructure identifier");
    expect(names("a", join("prj_", "A".repeat(28)))).toContain("Neon/Vercel infrastructure identifier");
    expect(scanText("a", "ep-silent-hill-b7rpraoc.c-13.us-east-1.aws.neon.tech")).toEqual([]);
  });

  it("lets obviously fake test values through", () => {
    expect(scanText("a", `vi.stubEnv("K", "${join("sk_", "live_", "not-real-but-long-enough-123456")}")`)).toEqual([]);
    expect(scanText("a", `${join("sk_", "live_", "secret")}`)).toEqual([]); // too short to be real
  });

  it("refuses committed env files and key files, but allows .env.example", () => {
    expect(scanPath(".env").length).toBe(1);
    expect(scanPath(".env.production").length).toBe(1);
    expect(scanPath("certs/server.pem").length).toBe(1);
    expect(scanPath(".env.example")).toEqual([]);
    expect(scanPath("src/app/page.tsx")).toEqual([]);
  });

  it("never prints the secret itself, only its start and length", () => {
    const [finding] = scanText("a.ts", join("sk_", "live_", "A1b2C3d4E5f6G7h8I9j0K1l2"));
    expect(finding.preview).toMatch(/^sk_liv…\(\d+ chars\)$/);
    expect(JSON.stringify(finding)).not.toContain("A1b2C3d4E5f6G7h8I9j0K1l2");
  });
});
