import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ settings: vi.fn(), launch: vi.fn() }));
vi.mock("@/domains/settings", () => ({ getBusinessSettings: m.settings }));
vi.mock("@/domains/launch", () => ({ getLaunchSettings: m.launch }));
vi.mock("next/font/google", () => ({ Manrope: () => ({ variable: "test-font" }) }));
import { generateMetadata } from "@/app/layout";
beforeEach(() => { vi.clearAllMocks(); m.launch.mockResolvedValue({ prelaunchMode: true }); });
it("uses the current saved business name for root, child-template and social titles on successive reads", async () => {
  for (const name of ["Business One", "Updated Business"]) {
    m.settings.mockResolvedValue({ publicBusinessName: name });
    const metadata = await generateMetadata();
    expect(metadata.title).toEqual({ default: `${name} — Appliance Rentals in Colorado`, template: `%s — ${name}` });
    expect(metadata.openGraph).toMatchObject({ title: `${name} — Appliance Rentals in Colorado`, siteName: name });
    expect(metadata.twitter).toMatchObject({ title: `${name} — Appliance Rentals in Colorado` });
    expect(JSON.stringify(metadata)).not.toContain("[Company Name]");
  }
  expect(m.settings).toHaveBeenCalledTimes(2);
});
