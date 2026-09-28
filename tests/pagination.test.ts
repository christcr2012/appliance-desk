import { describe, it, expect } from "vitest";
import { parsePage, paginationMeta, DEFAULT_PAGE_SIZE } from "@/domains/pagination";

// Pure page math shared by every paginated desk list (customers, inventory,
// jobs, activity) — see src/domains/pagination.ts and
// src/components/pagination.tsx.

describe("parsePage", () => {
  it("defaults to page 1 when nothing is given", () => {
    expect(parsePage(undefined)).toBe(1);
  });

  it("defaults to page 1 for garbage input", () => {
    expect(parsePage("banana")).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("1.5")).toBe(1);
  });

  it("defaults to page 1 for zero or negative numbers", () => {
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
  });

  it("parses a valid page number", () => {
    expect(parsePage("4")).toBe(4);
  });
});

describe("paginationMeta", () => {
  it("reports a single page when there are no results at all", () => {
    const meta = paginationMeta(0, 1);
    expect(meta).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalPages: 1,
      totalCount: 0,
      skip: 0,
    });
  });

  it("computes totalPages exactly on a page-size boundary", () => {
    const meta = paginationMeta(50, 1, 25);
    expect(meta.totalPages).toBe(2);
  });

  it("computes totalPages one over a page-size boundary", () => {
    const meta = paginationMeta(51, 1, 25);
    expect(meta.totalPages).toBe(3);
  });

  it("clamps a requested page below the valid range up to page 1", () => {
    const meta = paginationMeta(100, 0, 25);
    expect(meta.page).toBe(1);
  });

  it("clamps a requested page above the valid range down to the last page", () => {
    const meta = paginationMeta(30, 99, 25);
    expect(meta.page).toBe(2);
    expect(meta.totalPages).toBe(2);
  });

  it("computes skip from the clamped page, not the requested one", () => {
    const meta = paginationMeta(30, 99, 25);
    expect(meta.skip).toBe(25);
  });

  it("uses the default page size when none is given", () => {
    const meta = paginationMeta(10, 1);
    expect(meta.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });
});
