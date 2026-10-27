import { describe, expect, it } from "vitest";
import { BUILT_IN_VIEWS, LIST_HREF, builtInViewsFor } from "@/components/kit/built-in-views";
import { parseBillsParams } from "@/app/desk/billing/params";
import { ApplianceStatus } from "@prisma/client";

describe("AR-12 honest beginner-friendly list views", () => {
  it("lists all approved choices while hiding unsupported filters", () => {
    expect(Object.keys(BUILT_IN_VIEWS)).toEqual(["billing","customers","rentals","inventory","jobs","leads"]);
    expect(BUILT_IN_VIEWS.billing.map(v=>v.label)).toEqual(["Past due","Due this month","Autopay off"]);
    expect(BUILT_IN_VIEWS.customers.map(v=>v.label)).toEqual(["Renting now","Owe money","Property managers"]);
    for (const [key,entries] of Object.entries(BUILT_IN_VIEWS)) {
      const shown = builtInViewsFor(key as keyof typeof BUILT_IN_VIEWS);
      for (const item of shown) expect(item.href.startsWith(LIST_HREF[key as keyof typeof LIST_HREF]+"?")).toBe(true);
      for (const pending of entries.filter(e=>e.pending)) expect(shown.map(v=>v.id)).not.toContain(pending.id);
    }
  });
  it("each Billing view has params the production Bills parser handles", () => {
    for (const view of builtInViewsFor("billing")) {
      const parsed = parseBillsParams(Object.fromEntries(new URL(view.href,"https://example.test").searchParams.entries()));
      const spec = BUILT_IN_VIEWS.billing.find(v=>v.id===view.id)!;
      expect(parsed.status).toBe(spec.params.status);
      if(spec.params.due)expect(parsed.due?.preset).toBe(spec.params.due);
      if(spec.params.autopay)expect(parsed.autopay).toBe(spec.params.autopay);
    }
  });
  it("inventory statuses exist and the Property managers view is feature-controlled", () => {
    for (const view of BUILT_IN_VIEWS.inventory) expect(Object.values(ApplianceStatus)).toContain(view.params.status);
    expect(builtInViewsFor("customers").map(v=>v.label)).toEqual(["Renting now"]);
    expect(builtInViewsFor("customers",{shownFeatures:new Set(["propertyManagers"])}).map(v=>v.label))
      .toEqual(["Renting now","Property managers"]);
  });
});
