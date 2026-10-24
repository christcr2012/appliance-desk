import { timingSafeEqual } from "node:crypto";
import { isTestingEnvironment } from "./testing-environment";

/**
 * True when the request's Authorization header is exactly `Bearer <secret>`.
 * Compared in constant time so a caller cannot learn the secret one character at a time.
 */
export function cronAuthorized(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (isTestingEnvironment()) return false;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
