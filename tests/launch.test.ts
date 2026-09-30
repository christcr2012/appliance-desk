import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  launchSignupSchema,
  launchSettingsSchema,
} from "@/domains/launch/schema";
import { launchEmailBlockReason } from "@/domains/launch";
import { LAUNCH_STEPS, launchMessage } from "@/domains/launch/messages";

const signup = {
  name: "Local Neighbor",
  email: " Neighbor@Example.com ",
  city: "Greeley",
  interest: "Washer",
  consent: true,
};
const settings = {
  prelaunchMode: true,
  emailEnabled: true,
  postalAddress: "123 Example St, Greeley CO 80631",
  replyToEmail: "team@example.test",
};
afterEach(() => vi.unstubAllEnvs());

describe("launch signup and activation", () => {
  it("normalizes the email and refuses missing marketing consent or oversized input", () => {
    expect(launchSignupSchema.parse(signup).email).toBe("neighbor@example.com");
    expect(
      launchSignupSchema.safeParse({ ...signup, consent: false }).success,
    ).toBe(false);
    expect(
      launchSignupSchema.safeParse({ ...signup, email: "bad" }).success,
    ).toBe(false);
    expect(
      launchSignupSchema.safeParse({ ...signup, source: "x".repeat(101) })
        .success,
    ).toBe(false);
  });
  it("allows a paused setup but requires mailing address and reply inbox for activation", () => {
    expect(
      launchSettingsSchema.safeParse({
        ...settings,
        emailEnabled: false,
        postalAddress: "",
        replyToEmail: "",
      }).success,
    ).toBe(true);
    expect(
      launchSettingsSchema.safeParse({ ...settings, postalAddress: "" })
        .success,
    ).toBe(false);
    expect(
      launchSettingsSchema.safeParse({ ...settings, replyToEmail: "" }).success,
    ).toBe(false);
  });
  it("never sends in preview, or without production sender configuration", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(launchEmailBlockReason(settings)).toContain("production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(launchEmailBlockReason(settings)).toContain("not configured");
    vi.stubEnv("RESEND_API_KEY", "test");
    vi.stubEnv("RESEND_FROM_EMAIL", "Robinson <team@example.test>");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://untrusted.example");
    expect(launchEmailBlockReason(settings)).toContain("website URL");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://robinsonappliancerentals.com");
    expect(launchEmailBlockReason(settings)).toBeNull();
    expect(
      launchEmailBlockReason({ ...settings, emailEnabled: false }),
    ).toContain("paused");
    expect(
      launchEmailBlockReason({ ...settings, prelaunchMode: false }),
    ).toContain("paused");
  });
  it("has a finite sequence with no invented launch date or free-delivery promise", () => {
    expect(LAUNCH_STEPS.map((s) => s.delayAfterPreviousDays)).toEqual([
      0, 3, 4,
    ]);
    expect(launchMessage(0, "Sam").text).toContain("Hi Sam");
    expect(launchMessage(0, "Sam").text).toContain("doesn't reserve");
    expect(() => launchMessage(3, "Sam")).toThrow("Unknown");
  });
});
