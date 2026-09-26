import { describe, it, expect } from "vitest";
import { formatCents } from "@/domains/pricing";

describe("formatCents", () => {
  it("formats a whole-dollar amount with no decimal", () => {
    expect(formatCents(3500)).toBe("$35");
  });

  it("formats a fractional amount with cents", () => {
    expect(formatCents(3450)).toBe("$34.50");
  });

  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0");
  });
});
