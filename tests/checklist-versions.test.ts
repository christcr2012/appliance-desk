import { describe, expect, it } from "vitest";
import { CHECKLIST_MAX_ITEMS, cleanChecklistItems } from "@/domains/inventory/checklist-versions";

describe("checklist items", () => {
  it("trims, collapses spaces, drops blanks and repeats (ignoring capitals), keeps the order", () => {
    expect(cleanChecklistItems(["  Drum  spins freely ", "", "drum spins freely", "Door seal"])).toEqual({
      ok: true,
      items: ["Drum spins freely", "Door seal"],
    });
  });
  it("removes < and >", () => {
    expect(cleanChecklistItems(["Check <b>hoses</b>"])).toEqual({ ok: true, items: ["Check bhoses/b"] });
  });
  it("needs 1 to 40 items of 2 to 200 characters", () => {
    expect(cleanChecklistItems([]).ok).toBe(false);
    expect(cleanChecklistItems(["", "  "]).ok).toBe(false);
    expect(cleanChecklistItems(["x"]).ok).toBe(false);
    expect(cleanChecklistItems(["ab"]).ok).toBe(true);
    expect(cleanChecklistItems(["a".repeat(200)]).ok).toBe(true);
    expect(cleanChecklistItems(["a".repeat(201)]).ok).toBe(false);
    const many = Array.from({ length: CHECKLIST_MAX_ITEMS }, (_, i) => `Item number ${i}`);
    expect(cleanChecklistItems(many).ok).toBe(true);
    expect(cleanChecklistItems([...many, "One more item"]).ok).toBe(false);
  });
  it("refuses non-text input", () => {
    expect(cleanChecklistItems("nope").ok).toBe(false);
    expect(cleanChecklistItems([1]).ok).toBe(false);
  });
});
