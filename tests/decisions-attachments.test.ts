import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { checkDecisionFile, sniffDecisionFile, zipEntryNames } from "@/domains/decisions/attachments";
import { decisionsCardDue, nextDecisionsCardDay } from "@/domains/decisions/today";
import { readPreferences, validatePreferences } from "@/domains/workspace/preferences";
import { decisionErrorMessage } from "@/domains/decisions/messages";

// DEC-1b: completed forms are checked by content (never by name), the weekly Today card, and plain error words.

async function zipWith(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return new Uint8Array(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

describe("decision file checks", () => {
  it("knows a PDF and a Word .docx by their content", async () => {
    expect(sniffDecisionFile(new TextEncoder().encode("%PDF-1.7\n..."))).toBe("pdf");
    expect(sniffDecisionFile(await zipWith({ "[Content_Types].xml": "<x/>", "word/document.xml": "<w/>" }))).toBe("docx");
  });

  it("refuses other zips, pictures, text and renamed files", async () => {
    expect(sniffDecisionFile(await zipWith({ "[Content_Types].xml": "<x/>", "xl/workbook.xml": "<w/>" }))).toBeNull();
    expect(sniffDecisionFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull();
    expect(sniffDecisionFile(new TextEncoder().encode("<html>%PDF-</html>"))).toBeNull();
    expect(() => checkDecisionFile(new TextEncoder().encode("hello"), ["pdf", "docx"])).toThrow(/PDF or a Word/);
    expect(() => checkDecisionFile(new TextEncoder().encode("%PDF-1"), ["docx"])).toThrow(/paste the answers/);
    expect(() => checkDecisionFile(new Uint8Array(0), ["pdf"])).toThrow(/empty/);
    expect(() => checkDecisionFile(new Uint8Array(4 * 1024 * 1024 + 1), ["pdf"])).toThrow(/4 MB/);
  });

  it("refuses a zip that would unpack to a huge size (a zip bomb)", async () => {
    const big = await zipWith({ "[Content_Types].xml": "<x/>", "word/document.xml": "a".repeat(41 * 1024 * 1024) });
    expect(big.length).toBeLessThan(4 * 1024 * 1024);
    expect(zipEntryNames(big)).toBeNull();
    expect(sniffDecisionFile(big)).toBeNull();
  });

  it("reads the names inside a normal zip", async () => {
    expect(zipEntryNames(await zipWith({ "a.txt": "1", "b/c.txt": "2" }))).toEqual(["a.txt", "b/", "b/c.txt"]);
    expect(zipEntryNames(new TextEncoder().encode("PK not really"))).toBeNull();
  });
});

describe("the weekly Decisions waiting card on Today", () => {
  it("shows when never shown, again the same day, and then only after 7 days", () => {
    expect(decisionsCardDue(undefined, "2026-10-25")).toBe(true);
    expect(decisionsCardDue("2026-10-25", "2026-10-25")).toBe(true);
    expect(decisionsCardDue("2026-10-25", "2026-10-26")).toBe(false);
    expect(decisionsCardDue("2026-10-25", "2026-10-31")).toBe(false);
    expect(decisionsCardDue("2026-10-25", "2026-11-01")).toBe(true); // across the November DST change
    expect(nextDecisionsCardDay("2026-03-05")).toBe("2026-03-12"); // across the March DST change
  });

  it("the shown day is kept in workspace preferences and survives a save", () => {
    const stored = { pinnedActionIds: [], hiddenOptionalCardIds: [], savedViews: [], decisionsCardShownOn: "2026-10-25" };
    expect(readPreferences(stored).decisionsCardShownOn).toBe("2026-10-25");
    const saved = validatePreferences(stored);
    expect(saved.ok && saved.value.decisionsCardShownOn).toBe("2026-10-25");
    expect(readPreferences({ ...stored, decisionsCardShownOn: "not a date" })).toEqual({ pinnedActionIds: [], hiddenOptionalCardIds: [], savedViews: [] });
  });
});

describe("plain error words", () => {
  it("passes the domain's plain sentences and hides technical ones", () => {
    expect(decisionErrorMessage(new Error("This changed since you opened it. Refresh to see the latest."))).toMatch(/changed since/);
    expect(decisionErrorMessage(new Error("Invalid `prisma.decisionRecord.create()` invocation:\nboom"))).toBe("That couldn't be saved. Try again.");
    expect(decisionErrorMessage("nope", "fallback")).toBe("fallback");
  });
});
