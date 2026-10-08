import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
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
    (a === 192 && b === 88 && parts[2] === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function ipv6Segments(address: string): number[] | null {
  const normalized = address.toLowerCase();
  if (normalized.includes(".")) return null;
  if ((normalized.match(/::/g) ?? []).length > 1) return null;

  const [leftText, rightText] = normalized.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText === undefined || rightText === "" ? [] : rightText.split(":");
  const parse = (part: string): number | null =>
    /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : null;
  const leftValues = left.map(parse);
  const rightValues = right.map(parse);
  if (
    leftValues.some((value) => value === null) ||
    rightValues.some((value) => value === null)
  ) {
    return null;
  }

  if (rightText === undefined) {
    return leftValues.length === 8 ? (leftValues as number[]) : null;
  }
  const zeros = 8 - leftValues.length - rightValues.length;
  if (zeros < 1) return null;
  return [
    ...(leftValues as number[]),
    ...Array.from({ length: zeros }, () => 0),
    ...(rightValues as number[]),
  ];
}

function isGloballyRoutableIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return false;

  const segments = ipv6Segments(normalized);
  if (!segments) return false;
  const [first, second] = segments;

  // Be intentionally conservative for SSRF: accept only global-unicast 2000::/3.
  if ((first & 0xe000) !== 0x2000) return false;

  // Reject IETF/special-purpose space, deprecated 6to4, and documentation ranges.
  if (first === 0x2001 && second <= 0x01ff) return false; // 2001:0000::/23
  if (first === 0x2001 && second === 0x0db8) return false; // 2001:db8::/32
  if (first === 0x2002) return false; // 2002::/16
  if (first === 0x3fff && second <= 0x0fff) return false; // 3fff::/20

  return true;
}

function isUnsafeIpv6(address: string): boolean {
  return !isGloballyRoutableIpv6(address);
}

function isUnsafeAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isUnsafeIpv4(address);
  if (family === 6) return isUnsafeIpv6(address);
  return true;
}

async function resolvePublicAddresses(
  hostname: string,
  deadlineMs: number,
): Promise<ResolvedAddress[]> {
  if (unsafeHostname(hostname) || isIP(hostname) !== 0) {
    throw new Error("Official source host is not an allowed public hostname.");
  }

  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) {
    throw new Error("Official source request timed out.");
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Official source request timed out.")),
          remainingMs,
        );
      }),
    ]);

    if (addresses.length === 0) {
      throw new Error("Official source host did not resolve.");
    }
    if (addresses.some((entry) => isUnsafeAddress(entry.address))) {
      throw new Error("Official source host resolved to a non-public address.");
    }
    return addresses;
  } finally {
    if (timer) clearTimeout(timer);
  }
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

export function createPinnedLookup(
  address: string,
  family: number,
): (
  hostname: string,
  options: unknown,
  callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => void {
  return (_hostname, _options, callback) => {
    queueMicrotask(() => callback(null, address, family));
  };
}

function requestPinnedOfficialSource(
  parsed: URL,
  addresses: ResolvedAddress[],
  timeoutMs: number,
  maxBytes: number,
): Promise<{ contentType: "text/html" | "text/plain"; body: string }> {
  const selected = addresses[0];
  if (!selected) {
    throw new Error("Official source host did not resolve.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let request: ReturnType<typeof httpsRequest> | null = null;

    const finish = (
      result:
        | { ok: true; value: { contentType: "text/html" | "text/plain"; body: string } }
        | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result.ok) resolve(result.value);
      else reject(result.error);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      request?.destroy(new Error("Official source request timed out."));
    }, timeoutMs);

    request = httpsRequest(
      parsed,
      {
        method: "GET",
        family: selected.family,
        lookup: createPinnedLookup(selected.address, selected.family),
        headers: {
          accept: "text/html,text/plain;q=0.9",
          "accept-encoding": "identity",
          "user-agent": "ApplianceDesk-OfficialTaxSourceWatch/1.0",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          request?.destroy();
          finish({
            ok: false,
            error: new Error("Official source redirects are not followed."),
          });
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          request?.destroy();
          finish({
            ok: false,
            error: new Error(`Official source returned HTTP ${status}.`),
          });
          return;
        }

        const rawEncoding = response.headers["content-encoding"];
        const contentEncoding = (
          Array.isArray(rawEncoding) ? rawEncoding[0] ?? "" : rawEncoding ?? ""
        ).trim().toLowerCase();
        if (contentEncoding && contentEncoding !== "identity") {
          response.destroy();
          request?.destroy();
          finish({
            ok: false,
            error: new Error("Official source response used unsupported content encoding."),
          });
          return;
        }

        const rawContentType = response.headers["content-type"];
        const contentType = mediaType(
          Array.isArray(rawContentType) ? rawContentType[0] ?? null : rawContentType ?? null,
        );
        if (!contentType) {
          response.destroy();
          request?.destroy();
          finish({
            ok: false,
            error: new Error("Official source response was not HTML or plain text."),
          });
          return;
        }

        const rawLength = response.headers["content-length"];
        const lengthValue = Array.isArray(rawLength) ? rawLength[0] : rawLength;
        const declaredLength = Number(lengthValue);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.destroy();
          request?.destroy();
          finish({
            ok: false,
            error: new Error("Official source response exceeded the size limit."),
          });
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer | Uint8Array | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > maxBytes) {
            response.destroy();
            request?.destroy();
            finish({
              ok: false,
              error: new Error("Official source response exceeded the size limit."),
            });
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          finish({
            ok: true,
            value: {
              contentType,
              body: Buffer.concat(chunks).toString("utf8"),
            },
          });
        });
        response.on("error", (cause) => {
          if (settled) return;
          finish({
            ok: false,
            error:
              cause instanceof Error
                ? cause
                : new Error("Official source response failed."),
          });
        });
      },
    );

    request.on("error", (cause) => {
      if (settled) return;
      finish({
        ok: false,
        error: timedOut
          ? new Error("Official source request timed out.")
          : cause instanceof Error
            ? cause
            : new Error("Official source request failed."),
      });
    });
    request.end();
  });
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
  const deadlineMs = Date.now() + timeoutMs;
  const addresses = await resolvePublicAddresses(parsed.hostname, deadlineMs);
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) {
    throw new Error("Official source request timed out.");
  }

  const response = await requestPinnedOfficialSource(
    parsed,
    addresses,
    remainingMs,
    maxBytes,
  );
  const normalized = normalizeText(response.body);
  const hash = createHash("sha256").update(normalized, "utf8").digest("hex");

  return {
    finalUrl: parsed.toString(),
    contentType: response.contentType,
    text: truncateUtf8(normalized, STORED_TEXT_MAX_BYTES),
    hash,
  };
}
