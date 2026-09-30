import { describe, it, expect, vi, beforeEach } from "vitest";

// src/lib/email.ts — guarded exactly like src/lib/sms.ts's sendSms: never
// throws or hangs when RESEND_API_KEY isn't set, just logs and returns
// { sent: false }. This also covers the branded-HTML generation added
// 2026-09-29 (brand kit v2.0 "Evergreen" — see docs/DECISIONS.md): every
// call still just passes plain text, and this file builds a branded HTML
// version alongside it.

const emailsSend = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function Resend() {
    return { emails: { send: (...args: unknown[]) => emailsSend(...args) } };
  }),
}));

const ORIGINAL_ENV = { ...process.env };

describe("sendEmail", () => {
  it("reports a provider error returned without throwing as failed", async () => {
    process.env.RESEND_API_KEY = "test";
    emailsSend.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error" },
    });
    const { sendEmail } = await import("@/lib/email");
    expect(
      await sendEmail({ to: "a@example.test", subject: "Hi", text: "Hello" }),
    ).toEqual({ sent: false });
  });

  it("adds an escaped postal address, opt-out links and headers, and reply inbox for marketing only", async () => {
    process.env.RESEND_API_KEY = "test";
    const { sendEmail } = await import("@/lib/email");
    await sendEmail({
      to: "a@example.test",
      subject: "Welcome",
      text: "Hello",
      replyTo: "team@example.test",
      idempotencyKey: "launch/test/0",
      marketing: {
        postalAddress: "123 Main & Test <Suite>",
        unsubscribeUrl: "https://example.test/unsubscribe?token=abc",
      },
    });
    const [body, options] = emailsSend.mock.calls[0];
    expect(body.text).toContain("123 Main & Test <Suite>");
    expect(body.html).toContain("123 Main &amp; Test &lt;Suite&gt;");
    expect(body.html).toContain(
      'href="https://example.test/unsubscribe?token=abc"',
    );
    expect(body.replyTo).toBe("team@example.test");
    expect(body.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
    expect(options.idempotencyKey).toBe("launch/test/0");
  });
  beforeEach(() => {
    emailsSend
      .mockReset()
      .mockResolvedValue({ data: { id: "abc" }, error: null });
    process.env = { ...ORIGINAL_ENV };
  });

  it("no-ops and returns { sent: false } when RESEND_API_KEY isn't set", async () => {
    delete process.env.RESEND_API_KEY;
    vi.resetModules();
    const { sendEmail } = await import("@/lib/email");

    const result = await sendEmail({
      to: "a@example.com",
      subject: "Hi",
      text: "Hello there.",
    });

    expect(result).toEqual({ sent: false });
    expect(emailsSend).not.toHaveBeenCalled();
  });

  it("sends both text and a branded HTML body once configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.resetModules();
    const { sendEmail } = await import("@/lib/email");

    const result = await sendEmail({
      to: "a@example.com",
      subject: "Hi",
      text: "Hello there.\n\nSecond paragraph.",
    });

    expect(result).toEqual({ sent: true });
    expect(emailsSend).toHaveBeenCalledTimes(1);
    const call = emailsSend.mock.calls[0][0];
    expect(call.to).toBe("a@example.com");
    expect(call.subject).toBe("Hi");
    expect(call.text).toBe("Hello there.\n\nSecond paragraph.");
    expect(call.html).toContain("Hello there.");
    expect(call.html).toContain("Second paragraph.");
    expect(call.html).toContain("#123C2D"); // brand evergreen
    expect(call.html).toContain("ROBINSON");
  });

  it("renders a trailing bare URL as a branded button, not plain text", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.resetModules();
    const { sendEmail } = await import("@/lib/email");

    await sendEmail({
      to: "a@example.com",
      subject: "Reset your password",
      text: "Hi Jamie,\n\nUse the link below.\n\nhttps://example.com/reset?token=abc123",
      actionLabel: "Set my password",
    });

    const html = emailsSend.mock.calls[0][0].html as string;
    expect(html).toContain('href="https://example.com/reset?token=abc123"');
    expect(html).toContain("Set my password");
    // The bare URL must not also appear rendered as plain visible link text.
    expect(html).not.toContain(">https://example.com/reset?token=abc123<");
  });

  it("HTML-escapes user-submitted text so it can't break the markup", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.resetModules();
    const { sendEmail } = await import("@/lib/email");

    await sendEmail({
      to: "a@example.com",
      subject: "New lead",
      text: 'Lead note: <script>alert(1)</script> & "quoted" & things.',
    });

    const html = emailsSend.mock.calls[0][0].html as string;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;quoted&quot;");
  });

  it("logs and returns { sent: false } instead of throwing when Resend errors", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    emailsSend.mockRejectedValue(new Error("network down"));
    vi.resetModules();
    const { sendEmail } = await import("@/lib/email");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendEmail({
      to: "a@example.com",
      subject: "Hi",
      text: "Hello.",
    });

    expect(result).toEqual({ sent: false });
    errorSpy.mockRestore();
  });
});
