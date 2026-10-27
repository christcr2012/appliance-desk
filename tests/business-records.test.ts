import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, createZip } from "@/lib/zip";
import {
  adminCanSeeRecord,
  contentDisposition,
  effectiveRecordDate,
  sniffRecordFile,
} from "@/domains/paperwork/rules";
import { PAPERWORK_TEMPLATES } from "@/domains/paperwork/templates";
import { OBLIGATIONS } from "@/domains/compliance/registry";

// VAULT-1 pure rules: zip writer, file sniffing, the admin-visibility rule,
// the reminder date, and the starter list's own consistency.

describe("createZip", () => {
  it("round-trips entries through a strict local-header parse", () => {
    const entries = [
      { name: "index.pdf", data: new TextEncoder().encode("%PDF-fake-index") },
      { name: "license/scan.pdf", data: new Uint8Array(2048).fill(7) },
      { name: "empty.txt", data: new Uint8Array(0) },
    ];
    const zip = createZip(entries, new Date(2026, 10, 3));
    expect(zip.subarray(0, 2)).toEqual(new Uint8Array([0x50, 0x4b])); // "PK"
    // Parse local headers back and inflate.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let offset = 0;
    const seen: { name: string; data: Uint8Array }[] = [];
    while (view.getUint32(offset, true) === 0x04034b50) {
      const method = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength));
      const payload = zip.subarray(offset + 30 + nameLength + extraLength, offset + 30 + nameLength + extraLength + compressedSize);
      const data = method === 8 ? new Uint8Array(inflateRawSync(payload)) : payload;
      seen.push({ name, data });
      offset += 30 + nameLength + extraLength + compressedSize;
    }
    expect(seen.map((s) => s.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i += 1) {
      expect(seen[i]!.data).toEqual(entries[i]!.data);
      expect(crc32(entries[i]!.data)).toBeGreaterThanOrEqual(0);
    }
    // Central directory + end record are present.
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
  });

  it("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("sniffRecordFile", () => {
  it("accepts PDF, PNG, JPEG and WebP by their real bytes", () => {
    expect(sniffRecordFile(new TextEncoder().encode("%PDF-1.7 rest"))?.contentType).toBe("application/pdf");
    expect(
      sniffRecordFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))?.contentType,
    ).toBe("image/png");
    expect(sniffRecordFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))?.contentType).toBe("image/jpeg");
    const webp = new Uint8Array(16);
    webp.set(new TextEncoder().encode("RIFF"), 0);
    webp.set(new TextEncoder().encode("WEBP"), 8);
    expect(sniffRecordFile(webp)?.contentType).toBe("image/webp");
  });

  it("refuses an executable renamed as a PDF, and plain text", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]); // "MZ" header
    expect(sniffRecordFile(exe)).toBeNull();
    expect(sniffRecordFile(new TextEncoder().encode("just some text"))).toBeNull();
    expect(sniffRecordFile(new Uint8Array(0))).toBeNull();
  });
});

describe("adminCanSeeRecord", () => {
  const kinds = ["DOCUMENT", "LICENSE", "PERMIT", "REGISTRATION", "INSURANCE", "VEHICLE", "CONTRACT"];
  it("allows a listed kind with no number", () => {
    expect(adminCanSeeRecord({ kind: "LICENSE", hasNumber: false }, kinds)).toBe(true);
  });
  it("denies an unlisted kind", () => {
    expect(adminCanSeeRecord({ kind: "TAX_ACCOUNT", hasNumber: false }, kinds)).toBe(false);
    expect(adminCanSeeRecord({ kind: "BANK", hasNumber: false }, kinds)).toBe(false);
  });
  it("denies ANY kind when the record holds a number, even a listed one", () => {
    expect(adminCanSeeRecord({ kind: "INSURANCE", hasNumber: true }, kinds)).toBe(false);
    expect(adminCanSeeRecord({ kind: "DOCUMENT", hasNumber: true }, [...kinds, "BANK"])).toBe(false);
  });
});

describe("effectiveRecordDate", () => {
  it("takes the earlier of expiry and due, and handles either being unset", () => {
    const jan = new Date("2027-01-01T00:00:00Z");
    const jun = new Date("2027-06-01T00:00:00Z");
    expect(effectiveRecordDate({ dueOn: jun, expiresOn: jan })).toBe(jan);
    expect(effectiveRecordDate({ dueOn: jan, expiresOn: jun })).toBe(jan);
    expect(effectiveRecordDate({ dueOn: null, expiresOn: jun })).toBe(jun);
    expect(effectiveRecordDate({ dueOn: jan, expiresOn: null })).toBe(jan);
    expect(effectiveRecordDate({ dueOn: null, expiresOn: null })).toBeNull();
  });
});

describe("VAULT-1 starter templates", () => {
  it("have unique keys, valid kinds, and only link compliance keys that exist", () => {
    const keys = PAPERWORK_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    const obligationKeys = new Set(OBLIGATIONS.map((o) => o.key));
    for (const template of PAPERWORK_TEMPLATES) {
      for (const linked of template.linkedObligationKeys ?? []) {
        expect(obligationKeys.has(linked), `${template.key} links ${linked}`).toBe(true);
      }
    }
  });

  it("cover the spec's starter records", () => {
    const byKey = new Map(PAPERWORK_TEMPLATES.map((t) => [t.key, t]));
    expect(byKey.get("ein")?.kind).toBe("TAX_ACCOUNT");
    expect(byKey.get("ein")?.numberLabel).toBe("EIN");
    expect(byKey.get("co-sales-tax-license")?.kind).toBe("LICENSE");
    expect(byKey.get("co-sales-tax-license")?.repeatEveryMonths).toBe(24);
    expect(byKey.get("iris-tcc")?.linkedObligationKeys).toContain("fed.1099_nec");
    expect(byKey.get("usdot")?.linkedObligationKeys).toContain("fed.usdot");
    expect(byKey.get("vehicle-registration")?.linkedObligationKeys).toContain("co.vehicle_registration");
    expect(byKey.get("local-licenses")?.linkedObligationKeys).toContain("greeley.business_license");
    for (const key of [
      "ein-letter", "co-account-number", "revenue-online-login", "weld-assessor", "irs-online",
      "eftps", "sos-account", "trade-name", "stripe-account", "workspace-domain", "vercel-neon",
      "equipment-insurance", "vehicle-title", "resale-certificates", "twilio-a2p", "cpa-engagement",
    ]) {
      expect(byKey.has(key), key).toBe(true);
    }
  });
});

describe("contentDisposition", () => {
  it("keeps a plain ASCII name as-is", () => {
    expect(contentDisposition("ein-letter.pdf")).toBe(
      "inline; filename=\"ein-letter.pdf\"; filename*=UTF-8''ein-letter.pdf",
    );
  });

  it("encodes a non-Latin-1 name instead of throwing on the header", () => {
    const header = contentDisposition("保険.pdf");
    // The quoted fallback is pure ASCII (header-safe); the real name rides filename*.
    expect(header).toMatch(/^inline; filename="[ -~]*"; filename\*=UTF-8''%E4%BF%9D%E9%99%BA\.pdf$/);
    expect(header).not.toContain("保険");
  });

  it("neutralizes quotes and newlines in the fallback", () => {
    const header = contentDisposition("a\"b\nc.pdf");
    expect(header).toContain("filename=\"a_b_c.pdf\"");
  });
});
