import { describe, expect, it } from "vitest";
import {
  encodeOrderCursor,
  encodePurchaseCursor,
  parsePurchasesParams,
  purchasesHref,
} from "@/app/desk/purchases/params";
import {
  encodePartsCursor,
  parsePartsParams,
  partsHref,
} from "@/app/desk/parts/params";
import {
  encodeSuppliersCursor,
  parseSuppliersParams,
  suppliersHref,
} from "@/app/desk/suppliers/params";

// AR-6b: the equipment pages' URL params are pure — views, filters and
// the opaque cursors each view decodes only for itself.
describe("purchases params", () => {
  it("defaults to the appliance purchases view, open orders, no filters", () => {
    const p = parsePurchasesParams({});
    expect(p.view).toBe("purchases");
    expect(p.status).toBe("open");
    expect(p.q).toBe("");
    expect(p.seller).toBeUndefined();
    expect(p.purchaseCursor).toBeUndefined();
  });

  it("round-trips a purchase cursor only in the purchases view", () => {
    const cursor = encodePurchaseCursor({
      purchasedOn: "2026-03-15T10:00:00.000Z",
      createdAt: "2026-03-16T09:00:00.000Z",
      id: "p-1",
    });
    expect(parsePurchasesParams({ cursor }).purchaseCursor).toEqual({
      purchasedOn: "2026-03-15T10:00:00.000Z",
      createdAt: "2026-03-16T09:00:00.000Z",
      id: "p-1",
    });
    // The same value means nothing to the orders view.
    expect(parsePurchasesParams({ view: "orders", cursor }).orderCursor).toBeUndefined();
  });

  it("round-trips an order cursor only in the orders view", () => {
    const cursor = encodeOrderCursor({ createdAt: "2026-03-16T09:00:00.000Z", id: "o-1" });
    expect(parsePurchasesParams({ view: "orders", cursor }).orderCursor).toEqual({
      createdAt: "2026-03-16T09:00:00.000Z",
      id: "o-1",
    });
    expect(parsePurchasesParams({ cursor }).purchaseCursor).toBeUndefined();
  });

  it("ignores a malformed cursor instead of failing the page", () => {
    const p = parsePurchasesParams({ cursor: "!!!not-a-cursor!!!" });
    expect(p.purchaseCursor).toBeUndefined();
    expect(p.orderCursor).toBeUndefined();
  });

  it("href keeps the view's own params and drops the other view's", () => {
    const base = parsePurchasesParams({ view: "orders", status: "received", q: " belts " });
    expect(purchasesHref(base)).toBe("/desk/purchases?view=orders&q=belts&status=received");
    expect(purchasesHref(parsePurchasesParams({}))).toBe("/desk/purchases");
  });
});

describe("parts params", () => {
  it("defaults to the in-stock tab with no filters", () => {
    const p = parsePartsParams({});
    expect(p.status).toBe("in-stock");
    expect(p.q).toBe("");
    expect(p.type).toBeUndefined();
    expect(p.cursor).toBeUndefined();
  });

  it("round-trips the (modelNumber, id) cursor and ignores foreign tags", () => {
    const cursor = encodePartsCursor({ modelNumber: "M-100", id: "part-1" });
    expect(parsePartsParams({ cursor }).cursor).toEqual({ modelNumber: "M-100", id: "part-1" });
    const foreign = encodeSuppliersCursor({ name: "Parts Co", id: "s-1" });
    expect(parsePartsParams({ cursor: foreign }).cursor).toBeUndefined();
    expect(parsePartsParams({ cursor: "garbage" }).cursor).toBeUndefined();
  });

  it("keeps the tab, search and type in the Load-more href", () => {
    const base = parsePartsParams({ status: "low", q: " pump ", type: "type-1" });
    expect(partsHref(base, { cursor: "abc" })).toBe(
      "/desk/parts?status=low&q=pump&type=type-1&cursor=abc",
    );
    expect(partsHref(parsePartsParams({}))).toBe("/desk/parts");
  });
});

describe("suppliers params", () => {
  it("defaults to the active tab with no search", () => {
    const p = parseSuppliersParams({});
    expect(p.status).toBe("active");
    expect(p.q).toBe("");
    expect(p.cursor).toBeUndefined();
  });

  it("round-trips the (name, id) cursor and ignores foreign tags", () => {
    const cursor = encodeSuppliersCursor({ name: "Parts Co", id: "s-1" });
    expect(parseSuppliersParams({ cursor }).cursor).toEqual({ name: "Parts Co", id: "s-1" });
    const foreign = encodePartsCursor({ modelNumber: "M-100", id: "part-1" });
    expect(parseSuppliersParams({ cursor: foreign }).cursor).toBeUndefined();
  });

  it("keeps the tab and search in the Load-more href", () => {
    const base = parseSuppliersParams({ status: "archived", q: " parts " });
    expect(suppliersHref(base, { cursor: "abc" })).toBe(
      "/desk/suppliers?status=archived&q=parts&cursor=abc",
    );
    expect(suppliersHref(parseSuppliersParams({}))).toBe("/desk/suppliers");
  });
});
