import { describe, expect, it } from "vitest";
import { collectFullRtcIssues } from "@/mcp/rtc-full-issues";

describe("RTC full issue reads reuse bounded, scoped MCP page calls", () => {
  it("stitches multiple cursor pages without dropping or repeating safe rows", async () => {
    const observed: (string | undefined)[] = [];
    const results: Record<string, { issues: unknown[]; nextCursor: string | null }> = {
      first: { issues: [{ id: "synthetic-a", title: "A".repeat(4200) }], nextCursor: "synthetic-a" },
      "synthetic-a": { issues: [{ id: "synthetic-b", title: "B".repeat(4200) }], nextCursor: "synthetic-b" },
      "synthetic-b": { issues: [{ id: "synthetic-c", title: "C".repeat(4200) }], nextCursor: null },
    };
    const full = await collectFullRtcIssues({ limit: 20 }, async args => {
      observed.push(args.cursor as string | undefined);
      return results[String(args.cursor ?? "first")];
    });
    expect(observed).toEqual([undefined, "synthetic-a", "synthetic-b"]);
    expect((full.issues as { id: string }[]).map(row => row.id))
      .toEqual(["synthetic-a", "synthetic-b", "synthetic-c"]);
    expect(full.truncated).toBe(false);
    expect(full.nextCursor).toBeNull();
    expect(Buffer.byteLength(JSON.stringify(full), "utf8")).toBeGreaterThan(8192);
  });
  it("rejects repeating cursors instead of looping indefinitely", async () => {
    let reads = 0;
    await expect(collectFullRtcIssues({}, async () => {
      reads++;
      return { issues: [{ id: "synthetic" }], nextCursor: "same-cursor" };
    })).rejects.toThrow("RTC_READ_CURSOR_INVALID");
    expect(reads).toBe(2);
  });
  it("caps a full read below the owned-result size budget", async () => {
    let page = 0;
    const result = await collectFullRtcIssues({}, async () => {
      page++;
      return { issues: [{ id: "synthetic-" + page, detail: "A".repeat(6000) }],
        nextCursor: "next-" + page };
    });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(480_100);
    expect((result.issues as unknown[]).length).toBeLessThan(100);
    expect(result.nextCursor).toBeTruthy();
  });
});
