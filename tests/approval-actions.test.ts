import { beforeEach, describe, expect, it, vi } from "vitest";

// AR-2 slice 1: the approval actions moved out of the approvals page. These
// tests pin the move's contract: same domain calls with the same arguments,
// OWNER only, both paths revalidated, and with inline=1 the outcome comes
// back as a value instead of a redirect (Today's Sheet toasts it).

const m = vi.hoisted(() => {
  class ApprovalInputError extends Error {}
  return {
    guard: vi.fn(),
    decide: vi.fn(),
    finish: vi.fn(),
    revalidate: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    ApprovalInputError,
  };
});

vi.mock("@/lib/session", () => ({ requireRole: m.guard }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/domains/approvals", () => ({
  ApprovalInputError: m.ApprovalInputError,
  decideApproval: m.decide,
  finishApprovedRequest: m.finish,
}));

import { decideApprovalAction, finishApprovalAction } from "@/app/desk/approvals/actions";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ user: { id: "owner-1" } });
  m.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

describe("decideApprovalAction", () => {
  it("inline=1 returns the outcome and calls the domain with the page's original arguments", async () => {
    m.decide.mockResolvedValue({ status: "APPROVED", state: "DONE" });
    const result = await decideApprovalAction(
      form({ requestId: "req-1", decision: "APPROVE", note: "ok", inline: "1" }),
    );
    expect(result).toEqual({ outcome: "approved" });
    expect(m.guard).toHaveBeenCalledWith("OWNER");
    expect(m.decide).toHaveBeenCalledWith("owner-1", "req-1", "APPROVE", "ok");
    expect(m.revalidate).toHaveBeenCalledWith("/desk/approvals");
    expect(m.revalidate).toHaveBeenCalledWith("/desk/today");
  });

  it("maps the waiting and uncertain states, and decline, to their outcome words' keys", async () => {
    m.decide.mockResolvedValue({ status: "APPROVED", state: "WAITING" });
    await expect(decideApprovalAction(form({ requestId: "r", decision: "APPROVE", inline: "1" })))
      .resolves.toEqual({ outcome: "waiting" });
    m.decide.mockResolvedValue({ status: "APPROVED", state: "UNCERTAIN" });
    await expect(decideApprovalAction(form({ requestId: "r", decision: "APPROVE", inline: "1" })))
      .resolves.toEqual({ outcome: "uncertain" });
    m.decide.mockResolvedValue({ status: "DECLINED" });
    await expect(decideApprovalAction(form({ requestId: "r", decision: "DECLINE", inline: "1" })))
      .resolves.toEqual({ outcome: "declined" });
    expect(m.decide).toHaveBeenLastCalledWith("owner-1", "r", "DECLINE", "");
  });

  it("an input error becomes the refused outcome, inline and by redirect", async () => {
    m.decide.mockRejectedValue(new m.ApprovalInputError("too late"));
    await expect(decideApprovalAction(form({ requestId: "r", decision: "APPROVE", inline: "1" })))
      .resolves.toEqual({ outcome: "refused" });
    await expect(decideApprovalAction(form({ requestId: "r", decision: "APPROVE" })))
      .rejects.toThrow("NEXT_REDIRECT:/desk/approvals?outcome=refused");
  });

  it("without inline it redirects to the approvals page with the outcome, as before", async () => {
    m.decide.mockResolvedValue({ status: "APPROVED", state: "DONE" });
    await expect(decideApprovalAction(form({ requestId: "r", decision: "APPROVE" })))
      .rejects.toThrow("NEXT_REDIRECT:/desk/approvals?outcome=approved");
  });
});

describe("finishApprovalAction", () => {
  it("inline=1 returns the outcome and revalidates both paths", async () => {
    m.finish.mockResolvedValue({ status: "APPROVED", state: "DONE" });
    await expect(finishApprovalAction(form({ requestId: "req-9", inline: "1" })))
      .resolves.toEqual({ outcome: "approved" });
    expect(m.finish).toHaveBeenCalledWith("owner-1", "req-9");
    expect(m.revalidate).toHaveBeenCalledWith("/desk/approvals");
    expect(m.revalidate).toHaveBeenCalledWith("/desk/today");
  });
});
