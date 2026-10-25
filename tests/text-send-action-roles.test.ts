import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), send: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/domains/messaging/workflow-text", () => ({
  sendWorkflowText: mocks.send, recordStaffTextConsent: vi.fn(), CONSENT_METHODS: {},
}));
vi.mock("@/domains/messaging/workflow-text-settings", () => ({
  approveWorkflowWording: vi.fn(), confirmWorkflowLegalReview: vi.fn(), saveWorkflowQuietHours: vi.fn(), setWorkflowTextEnabled: vi.fn(),
  setClickToCallEnabled: vi.fn(),
}));
vi.mock("@/domains/messaging/click-to-call", () => ({ startClickToCall: vi.fn() }));

import { sendTextAction, recordTextConsentAction } from "@/app/desk/_text/actions";

const form = () => { const f = new FormData(); for (const [k, v] of Object.entries({ family: "job_scheduled", subjectId: "j1", clientToken: "tok00000001", textHash: "h", path: "/desk/jobs/j1" })) f.set(k, v); return f; };

describe("send text action roles", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.send.mockResolvedValue({ kind: "ACCEPTED", message: "Sent." }); });
  it("lets an assigned staff member reach the send function (which enforces the assignment itself)", async () => {
    mocks.requireRole.mockImplementation(async (...roles: string[]) => { if (!roles.includes("STAFF")) throw new Error("redirect"); return { user: { id: "staff-1" } }; });
    const r = await sendTextAction(null, form());
    expect(r).toEqual({ ok: true, message: "Sent." });
    expect(mocks.send).toHaveBeenCalledWith("staff-1", expect.objectContaining({ family: "job_scheduled", subjectId: "j1" }));
  });
  it("recording customer permission stays owner/admin only", async () => {
    mocks.requireRole.mockImplementation(async (...roles: string[]) => { if (roles.includes("STAFF")) return { user: { id: "staff-1" } }; throw new Error("redirect"); });
    const f = form(); f.set("method", "PHONE"); f.set("customerId", "c1");
    await expect(recordTextConsentAction(null, f)).rejects.toThrow("redirect");
  });
});
