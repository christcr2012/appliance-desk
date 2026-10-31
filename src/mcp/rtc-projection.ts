/**
 * RTC 1 read projections sit outside domain tools so client fields and detail
 * metadata never bypass a strict MCP argument schema.
 * Only properties already present in guarded MCP output may be returned.
 */
const keyShape = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseRtcReadInput(args: Record<string, unknown>) {
  if (!isObject(args)) throw new Error("invalid_args");
  const { fields, detail, ...domainArgs } = args;
  if (detail !== undefined && detail !== "summary" && detail !== "full")
    throw new Error("invalid_args");
  if (fields === undefined) return { domainArgs, paths: null };
  const requested = typeof fields === "string" ? [fields] : fields;
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 20)
    throw new Error("invalid_args");
  const paths: string[][] = [];
  for (const raw of requested) {
    if (typeof raw !== "string" || raw.length > 320) throw new Error("invalid_args");
    const segments = raw.split(".");
    if (segments.length > 8 || !segments.every(s => keyShape.test(s) && !forbidden.has(s)))
      throw new Error("invalid_args");
    if (!paths.some(path => path.join(".") === raw)) paths.push(segments);
  }
  return { domainArgs, paths };
}

/** Only listed paths survive; no inherited properties or selectors with side effects. */
export function projectRtcRead(payload: unknown, paths: string[][] | null): unknown {
  if (paths === null) return payload;
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    let from: unknown = payload;
    for (const segment of path) {
      if (!isObject(from) || !Object.hasOwn(from, segment)) { from = undefined; break; }
      from = from[segment];
    }
    if (from === undefined) continue;
    let to = out;
    for (const segment of path.slice(0, -1)) {
      if (!isObject(to[segment])) to[segment] = {};
      to = to[segment] as Record<string, unknown>;
    }
    to[path.at(-1)!] = from;
  }
  return out;
}
