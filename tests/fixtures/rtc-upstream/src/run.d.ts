/** Local TypeScript binding only; the .js oracle itself is byte-identical upstream. */
export type RtcProbe = { name: string; ok: boolean; skipped?: boolean; message: string };
export type RtcProbeReport = { ok: boolean; checks: RtcProbe[] };
export function runConformance(input: {
  url: string;
  passes?: Record<string, string>;
  oauth?: unknown;
  instances?: unknown;
  fixtures?: unknown;
}): Promise<RtcProbeReport>;
