// While the website is "preparing to launch", pricing and city pages send visitors to the launch page. The owner's
// preview switches must survive that hop (so the preview works), and nothing else may ride along.
import { describe, expect, it } from "vitest";
import { launchPath } from "@/domains/site-content/launch-path";

describe("launchPath", () => {
  it("is the plain launch page for visitors and for anything unexpected", () => {
    expect(launchPath()).toBe("/launch");
    expect(launchPath({})).toBe("/launch");
    expect(launchPath({ select: "1" })).toBe("/launch");
    expect(launchPath({ revision: "bad value!", select: "1" })).toBe("/launch");
    expect(launchPath({ revision: ["abcdefgh1234"] })).toBe("/launch");
  });

  it("keeps a valid version, preview time and select switch, and nothing else", () => {
    expect(launchPath({ revision: "abcdefgh1234", previewAt: "2026-11-01T15:00:00Z", select: "1" })).toBe(
      "/launch?revision=abcdefgh1234&previewAt=2026-11-01T15%3A00%3A00Z&select=1",
    );
    expect(launchPath({ revision: "abcdefgh1234", previewAt: "tomorrow" })).toBe("/launch?revision=abcdefgh1234");
  });
});
