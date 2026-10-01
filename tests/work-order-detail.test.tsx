import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const m = vi.hoisted(() => ({ role: vi.fn(), job: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({ prisma: { job: { findUnique: m.job } } }));
vi.mock("@/domains/settings", () => ({ getBusinessSettings: m.settings }));
import { getWorkOrderDetail } from "@/domains/jobs/work-order-detail";
import { WorkOrderDocument } from "@/components/jobs/work-order-document";
import { DEFAULT_JOB_CHECKLISTS } from "@/domains/jobs/checklist";
const fixture = { id: "job", type: "DELIVERY", status: "SCHEDULED", checklist: null, scheduledAt: null, completedAt: null, notes: "Take care", completionNotes: null, createdAt: new Date(), customer: null, serviceAddress: null, appliances: [] };
beforeEach(() => {
  vi.clearAllMocks(); m.role.mockResolvedValue({ user: { role: "STAFF" } });
  m.settings.mockResolvedValue({ publicBusinessName: "Fixture", publicPhone: "555", publicEmail: "fixture@example.test", publicAddress: "CO", logoUrl: null });
});
it.each(Object.keys(DEFAULT_JOB_CHECKLISTS) as (keyof typeof DEFAULT_JOB_CHECKLISTS)[])("prints the fresh %s job's operational defaults", async type => {
  m.job.mockResolvedValue({ ...fixture, type });
  const detail = (await getWorkOrderDetail("job"))!;
  expect(detail.checklist).toEqual(DEFAULT_JOB_CHECKLISTS[type].map(item => ({ item, checked: false })));
  const html = renderToStaticMarkup(<WorkOrderDocument job={detail} />);
  for (const item of DEFAULT_JOB_CHECKLISTS[type]) expect(html).toContain(item);
});
it("retains saved checks and ignores malformed JSON entries", async () => {
  m.job.mockResolvedValue({ ...fixture, checklist: [{ item: "Saved check", checked: true }, { item: 3 }, null] });
  const detail = (await getWorkOrderDetail("job"))!;
  expect(detail.checklist).toEqual([{ item: "Saved check", checked: true }]);
  expect(renderToStaticMarkup(<WorkOrderDocument job={detail} />)).toContain("line-through");
});
it("recovers defaults from entirely malformed or empty saved JSON", async () => {
  for (const checklist of [[], [{ wrong: true }], "old-json"]) {
    m.job.mockResolvedValue({ ...fixture, checklist });
    expect((await getWorkOrderDetail("job"))!.checklist).toHaveLength(4);
  }
});
it("denies non-staff access before reading the document", async () => {
  m.role.mockRejectedValue(new Error("denied"));
  await expect(getWorkOrderDetail("job")).rejects.toThrow("denied");
  expect(m.job).not.toHaveBeenCalled();
});
