import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const STORED_TEXT_MAX_BYTES = 200 * 1024;

export type OfficialSourceFetchResult = {
  finalUrl: string;
  contentType: "text/html" | "text/plain";
  text: string;
  hash: string;
};

type ResolvedAddress = { address: string; family: number };

function unsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "internal" ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".local")
  );
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isUnsafeIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return true;
  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function mappedIpv4(address: string): string | null {
  const match = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return match?.[1] ?? null;
}

function isUnsafeIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mapped = mappedIpv4(normalized);
  if (mapped) return isUnsafeIpv4(mapped);

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

function isUnsafeAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isUnsafeIpv4(address);
  if (family === 6) return isUnsafeIpv6(address);
  return true;
}

async function resolvePublicAddresses(hostname: string): Promise<ResolvedAddress[]> {
  if (unsafeHostname(hostname) || isIP(hostname) !== 0) {
    throw new Error("Official source host is not an allowed public hostname.");
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("Official source host did not resolve.");
  }
  if (addresses.some((entry) => isUnsafeAddress(entry.address))) {
    throw new Error("Official source host resolved to a non-public address.");
  }
  return addresses;
}

function mediaType(value: string | null): "text/html" | "text/plain" | null {
  const type = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (type === "text/html" || type === "text/plain") return type;
  return null;
}

function normalizeText(value: string): string {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim());

  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let bytes = 0;
  let output = "";
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
  }
  return output;
}

function boundedOption(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > fallback) {
    throw new Error(`${label} must be a positive integer no greater than ${fallback}.`);
  }
  return value;
}

export async function fetchOfficialSourcePage(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<OfficialSourceFetchResult> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Official source URLs must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Official source URLs cannot include credentials.");
  }

  await resolvePublicAddresses(parsed.hostname);

  const timeoutMs = boundedOption(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    "timeoutMs",
  );
  const maxBytes = boundedOption(
    options.maxBytes,
    DEFAULT_MAX_BYTES,
    "maxBytes",
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsed, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,text/plain;q=0.9",
        "user-agent": "ApplianceDesk-OfficialTaxSourceWatch/1.0",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error("Official source redirects are not followed.");
    }
    if (!response.ok) {
      throw new Error(`Official source returned HTTP ${response.status}.`);
    }

    const contentType = mediaType(response.headers.get("content-type"));
    if (!contentType) {
      throw new Error("Official source response was not HTML or plain text.");
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      controller.abort();
      throw new Error("Official source response exceeded the size limit.");
    }

    if (!response.body) {
      throw new Error("Official source returned an empty response body.");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          controller.abort();
          throw new Error("Official source response exceeded the size limit.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
      "utf8",
    );
    const normalized = normalizeText(body);
    const hash = createHash("sha256").update(normalized, "utf8").digest("hex");

    return {
      finalUrl: parsed.toString(),
      contentType,
      text: truncateUtf8(normalized, STORED_TEXT_MAX_BYTES),
      hash,
    };
  } catch (cause) {
    if (controller.signal.aborted && cause instanceof Error && cause.name === "AbortError") {
      throw new Error("Official source request timed out.");
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
