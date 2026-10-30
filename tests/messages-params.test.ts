import { describe, expect, it } from "vitest";
import { parseMessagesParams } from "@/app/desk/communications/params";

// AR-4d / QUOTES-MESSAGES spec section 3: plain-word inbox params, with the
// legacy stored-code params (status=OPEN, resolution=…, assignment=…)
// mapping onto them so old links keep working.
describe("messages inbox params", () => {
  it("defaults to open / all / no match filter", () => {
    expect(parseMessagesParams({})).toEqual({
      status: "open",
      who: "all",
      match: undefined,
      cursor: undefined,
    });
  });

  it("reads the new plain-word params", () => {
    expect(
      parseMessagesParams({ status: "waiting", who: "mine", match: "several", cursor: "abc" }),
    ).toEqual({ status: "waiting", who: "mine", match: "several", cursor: "abc" });
  });

  it("maps every legacy status code", () => {
    expect(parseMessagesParams({ status: "OPEN" }).status).toBe("open");
    expect(parseMessagesParams({ status: "WAITING" }).status).toBe("waiting");
    expect(parseMessagesParams({ status: "CLOSED" }).status).toBe("done");
  });

  it("maps every legacy resolution code", () => {
    expect(parseMessagesParams({ resolution: "RESOLVED" }).match).toBe("known");
    expect(parseMessagesParams({ resolution: "UNRESOLVED" }).match).toBe("unknown");
    expect(parseMessagesParams({ resolution: "AMBIGUOUS" }).match).toBe("several");
  });

  it("maps the legacy assignment param", () => {
    expect(parseMessagesParams({ assignment: "mine" }).who).toBe("mine");
    expect(parseMessagesParams({ assignment: "unassigned" }).who).toBe("unassigned");
    expect(parseMessagesParams({ assignment: "all" }).who).toBe("all");
  });

  it("new params win when both spellings are present", () => {
    const p = parseMessagesParams({
      status: "done",
      resolution: "RESOLVED",
      match: "unknown",
      assignment: "mine",
      who: "unassigned",
    });
    expect(p.status).toBe("done");
    expect(p.match).toBe("unknown");
    expect(p.who).toBe("unassigned");
  });

  it("unknown values fall back to defaults instead of throwing", () => {
    const p = parseMessagesParams({ status: "SIDEWAYS", who: "everybody", match: "maybe" });
    expect(p).toEqual({ status: "open", who: "all", match: undefined, cursor: undefined });
  });

  it("takes the first of repeated params", () => {
    expect(parseMessagesParams({ status: ["waiting", "done"] }).status).toBe("waiting");
  });
});
