import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AutomationLine, automationText } from "@/components/kit";

afterEach(cleanup);
describe("AR-12 automatic work line", () => {
  it("adds the prefix when missing and never doubles an existing prefix", () => {
    expect(automationText("  a bill is prepared monthly  ")).toBe("Automatic: a bill is prepared monthly");
    expect(automationText("Automatic: a bill is made.")).toBe("Automatic: a bill is made.");
    render(<AutomationLine text="Automatic: a bill is made on the 3rd of each month." />);
    expect(screen.getByText("Automatic: a bill is made on the 3rd of each month.")).toBeInTheDocument();
    expect(screen.getAllByText(/Automatic:/)).toHaveLength(1);
  });
});
