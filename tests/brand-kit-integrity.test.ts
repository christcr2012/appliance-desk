import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BRAND_ROOT = resolve(process.cwd(), "docs/brand");
const CHECKSUMS_PATH = resolve(BRAND_ROOT, "00_Start_Here/SHA256SUMS.txt");
const MANIFEST_PATH = resolve(BRAND_ROOT, "00_Start_Here/Asset-manifest.csv");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checksumEntries(): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of readFileSync(CHECKSUMS_PATH, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    expect(match, `malformed checksum line: ${line}`).not.toBeNull();
    if (!match) continue;
    entries.set(match[2], match[1]);
  }
  return entries;
}

describe("brand-kit integrity", () => {
  it("checksums every advertised production asset", () => {
    const entries = checksumEntries();
    expect(entries.size).toBeGreaterThan(0);

    for (const [relativePath, expectedHash] of entries) {
      expect(relativePath.startsWith("10_Concept_Visualization/")).toBe(false);
      const path = resolve(BRAND_ROOT, relativePath);
      expect(existsSync(path), `checksum references missing file: ${relativePath}`).toBe(true);
      expect(sha256(path), `checksum mismatch: ${relativePath}`).toBe(expectedHash);
    }
  });

  it("keeps manifest byte counts aligned with checked-in production assets", () => {
    const checksums = checksumEntries();
    const [header, ...rows] = readFileSync(MANIFEST_PATH, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);

    expect(header).toBe("path,bytes,format");
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const [relativePath, rawBytes, format, ...extra] = row.split(",");
      expect(extra, `unexpected comma in manifest row: ${row}`).toHaveLength(0);
      expect(relativePath.startsWith("10_Concept_Visualization/")).toBe(false);
      expect(format.length, `missing format in manifest row: ${row}`).toBeGreaterThan(0);

      const expectedBytes = Number(rawBytes);
      expect(Number.isSafeInteger(expectedBytes) && expectedBytes >= 0).toBe(true);
      const path = resolve(BRAND_ROOT, relativePath);
      expect(existsSync(path), `manifest references missing file: ${relativePath}`).toBe(true);
      expect(statSync(path).size, `byte-count mismatch: ${relativePath}`).toBe(expectedBytes);
      expect(checksums.has(relativePath), `manifest file missing checksum: ${relativePath}`).toBe(true);
    }
  });

  it("contains a production-resolution rendered light-mark PNG", () => {
    const lightMark = resolve(BRAND_ROOT, "01_Logos/mark/Robinson-mark-light.png");
    expect(existsSync(lightMark)).toBe(true);
    expect(statSync(lightMark).size).toBeGreaterThan(0);
    const bytes = readFileSync(lightMark);
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(bytes.readUInt32BE(16)).toBe(1600);
    expect(bytes.readUInt32BE(20)).toBe(1600);
  });
});
