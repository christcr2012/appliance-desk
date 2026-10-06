import { describe, expect, it } from "vitest";
import { messageStateLabel } from "@/domains/messaging/history";

describe("message history labels", () => {
  it("never describes uncertain or unsent states as sent", () => {
    expect(messageStateLabel("NOT_SENT")).toBe("Not sent");
    expect(messageStateLabel("FAILED")).toBe("Failed");
    expect(messageStateLabel("UNKNOWN")).toBe("Outcome unknown");
    expect(messageStateLabel("ACCEPTED")).toBe("Accepted by provider");
    expect(messageStateLabel("DELIVERED")).toBe("Delivered");
  });
});
