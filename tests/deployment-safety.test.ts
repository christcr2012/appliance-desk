import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: vi.fn(), sms: vi.fn(), stripe: vi.fn(), event: vi.fn(),
  processEvent: vi.fn(), upload: vi.fn(), session: vi.fn(),
  put: vi.fn(), list: vi.fn(), del: vi.fn(), read: vi.fn(),
}));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.email }; } }));
vi.mock("twilio", () => ({ default: () => ({ messages: { create: mocks.sms } }) }));
vi.mock("stripe", () => ({ default: class {
  constructor(key: string) { mocks.stripe(key); }
  webhooks = { constructEvent: mocks.event };
} }));
vi.mock("@/domains/billing/webhooks", () => ({ processStripeWebhookEvent: mocks.processEvent }));
vi.mock("@/lib/session", () => ({ getServerSession: mocks.session }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.upload }));
vi.mock("@vercel/blob", () => ({ put: mocks.put, list: mocks.list, del: mocks.del }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => ({ findMany: mocks.read }) }) }));
vi.mock("@/domains/settings", () => ({ getBusinessSettings: vi.fn() }));

import { isNonProductionDeployment } from "@/lib/deployment-safety";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { getStripeClient, __setStripeClientForTests } from "@/lib/stripe";
import { POST as webhook } from "@/app/api/webhooks/stripe/route";
import { POST as upload } from "@/app/api/uploads/photo/route";
import { exportDatabaseBackup } from "@/domains/backup";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  // Deliberately configured: absence of credentials is not the safety gate.
  vi.stubEnv("RESEND_API_KEY", "configured-email-key");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "configured-sid");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "configured-token");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+13035550199");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_configured");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_configured");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "configured-storage-token");
  mocks.email.mockResolvedValue({ data: { id: "email-1" }, error: null });
  mocks.sms.mockResolvedValue({ sid: "sms-1" });
  mocks.event.mockReturnValue({ id: "evt_test", livemode: false });
  mocks.session.mockResolvedValue({ user: { id: "owner-1", role: "OWNER" } });
  mocks.upload.mockResolvedValue({ clientToken: "token" });
  mocks.read.mockResolvedValue([]);
  __setStripeClientForTests(null);
});
afterEach(() => { vi.unstubAllEnvs(); __setStripeClientForTests(null); });

describe("deployment classification", () => {
  it.each(["preview", "development", "staging", ""])("blocks side effects for %s", (environment) => {
    expect(isNonProductionDeployment({ VERCEL_ENV: environment })).toBe(true);
  });
  it("fails closed when a Vercel deployment has no environment", () => {
    expect(isNonProductionDeployment({ VERCEL: "1" })).toBe(true);
  });
  it("preserves production and local/CI behavior", () => {
    expect(isNonProductionDeployment({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(isNonProductionDeployment({})).toBe(false);
  });
});

describe("configured messaging providers", () => {
  it.each(["preview", "development", "staging"])("does not email or text in %s", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await sendEmail({ to: "copied-customer@example.test", subject: "Private", text: "Private content" })).toEqual({ sent: false, outcome: "NOT_ATTEMPTED" });
      expect(await sendSms({ to: "+13035550100", body: "Private content" })).toEqual({ sent: false });
      expect(mocks.email).not.toHaveBeenCalled();
      expect(mocks.sms).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("continues to deliver through configured production providers", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await sendEmail({ to: "customer@example.test", subject: "Hi", text: "Hello" })).toEqual({ sent: true, outcome: "SENT" });
    expect(await sendSms({ to: "+13035550100", body: "Hello" })).toEqual({ sent: true });
    expect(mocks.email).toHaveBeenCalledOnce();
    expect(mocks.sms).toHaveBeenCalledOnce();
  });
});

describe("Stripe environment enforcement", () => {
  it.each(["sk_live_not-real", "rk_live_not-real", "invalid", undefined])("refuses %s before constructing a preview client", (key) => {
    vi.stubEnv("STRIPE_SECRET_KEY", key);
    expect(() => getStripeClient()).toThrow(/test key/);
    expect(mocks.stripe).not.toHaveBeenCalled();
  });
  it.each(["sk_test_not-real", "rk_test_not-real"])("allows %s for preview testing", (key) => {
    vi.stubEnv("STRIPE_SECRET_KEY", key);
    getStripeClient();
    expect(mocks.stripe).toHaveBeenCalledWith(key);
  });
  it("rechecks configuration before returning a cached client", () => {
    getStripeClient();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not-real");
    expect(() => getStripeClient()).toThrow(/test key/);
    expect(mocks.stripe).toHaveBeenCalledOnce();
  });
  it("preserves the production live-key path", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not-real");
    getStripeClient();
    expect(mocks.stripe).toHaveBeenCalledWith("sk_live_not-real");
  });
});

function webhookRequest() {
  return new Request("https://preview.example.test/api/webhooks/stripe", {
    method: "POST", headers: { "stripe-signature": "signature" }, body: "raw-body",
  });
}
describe("verified webhook event modes", () => {
  it("rejects a signed live event before any business processing in preview", async () => {
    mocks.event.mockReturnValue({ id: "evt_live", livemode: true });
    expect((await webhook(webhookRequest())).status).toBe(400);
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });
  it("processes a signed test event in preview", async () => {
    expect((await webhook(webhookRequest())).status).toBe(200);
    expect(mocks.processEvent).toHaveBeenCalledWith({ id: "evt_test", livemode: false });
  });
  it("preserves live event processing in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.event.mockReturnValue({ id: "evt_live", livemode: true });
    expect((await webhook(webhookRequest())).status).toBe(200);
    expect(mocks.processEvent).toHaveBeenCalledOnce();
  });
  it("returns a configuration failure for an inherited live preview key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not-real");
    expect((await webhook(webhookRequest())).status).toBe(503);
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });
});

function uploadRequest() {
  return new Request("https://preview.example.test/api/uploads/photo", {
    method: "POST", body: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname: "appliance-types/photo.jpg", multipart: false, clientPayload: null } }),
  });
}
describe("storage writes", () => {
  it("does not mint a preview upload token even with a storage credential", async () => {
    expect((await upload(uploadRequest())).status).toBe(503);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("retains the anonymous authentication rejection", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await upload(uploadRequest())).status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("preserves production uploads", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await upload(uploadRequest())).status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledOnce();
  });
  it("refuses preview backup reads, writes and retention deletion", async () => {
    expect(await exportDatabaseBackup()).toMatchObject({ ok: false, error: expect.stringContaining("disabled") });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });
});
