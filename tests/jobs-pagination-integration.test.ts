import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }),
}));
import { prisma } from "@/lib/prisma";
import { getJobsCount, getJobsPage } from "@/domains/jobs";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)("stable job pages in disposable CI Postgres", () => {
  const tag = randomUUID();
  const scheduled = Array.from(
    { length: 30 },
    (_, i) => `paging-${tag}-s${String(i).padStart(2, "0")}`,
  );
  const unscheduled = Array.from(
    { length: 30 },
    (_, i) => `paging-${tag}-u${String(i).padStart(2, "0")}`,
  );
  const ids = [...scheduled, ...unscheduled];
  afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: { in: ids } } });
  });
  it("walks tied and unscheduled jobs without repetitions or omissions", async () => {
    await prisma.job.createMany({
      data: ids
        .slice()
        .reverse()
        .map((id) => ({
          id,
          type: "MAINTENANCE_VISIT",
          status: "CANCELLED",
          scheduledAt: scheduled.includes(id)
            ? new Date("2026-10-01T15:00:00Z")
            : null,
        })),
    });
    const count = await getJobsCount({ status: "CANCELLED" });
    const all = [];
    for (let offset = 0; offset < count; offset += 25)
      all.push(...(await getJobsPage({ status: "CANCELLED" }, offset, 25)));
    expect(new Set(all.map((job) => job.id)).size).toBe(count);
    expect(
      all.filter((job) => ids.includes(job.id)).map((job) => job.id),
    ).toEqual(ids);
    expect(all[0]).not.toHaveProperty("partsCostCents");
  });
});
