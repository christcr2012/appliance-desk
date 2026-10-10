import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MetricoolTracker } from "@/components/site/metricool-tracker";
let path = "/launch";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
vi.mock("@/lib/metricool", () => ({
  metricoolVisit: () => path === "/privacy" ? null : "https://tracker.metricool.com/c3po.jpg?u=" + path,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("counts a return through an excluded page, without counting that page or duplicate effects", () => {
  const sent: string[] = [];
  class Pixel { set src(value: string) { sent.push(value); } }
  vi.stubGlobal("Image", Pixel);
  path = "/launch";
  const view = render(<StrictMode><MetricoolTracker hash="test" siteOrigin="test" /></StrictMode>);
  expect(sent).toHaveLength(1);
  path = "/privacy";
  view.rerender(<StrictMode><MetricoolTracker hash="test" siteOrigin="test" /></StrictMode>);
  expect(sent).toHaveLength(1);
  path = "/launch";
  view.rerender(<StrictMode><MetricoolTracker hash="test" siteOrigin="test" /></StrictMode>);
  expect(sent).toHaveLength(2);
});
