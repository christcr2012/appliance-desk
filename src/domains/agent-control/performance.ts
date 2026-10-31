import { prisma } from "@/lib/prisma";

/** Only fixed, tested labels are ever persisted; never routes with IDs, query text or user data. */
export const PERFORMANCE_NAMES = {
  PAGE: ["desk:system-health", "desk:settings", "desk:today"],
  ACTION: ["monitor-rule-save", "optimization-proposal-create"],
  JOB: ["system-issues-sweep"],
  QUERY: ["system-issue-list", "settings-map-search"],
} as const;
export type PerformanceKind = keyof typeof PERFORMANCE_NAMES;
export type PerfReceipt = { kind: PerformanceKind; name: string; ms: number; ok: boolean; at: Date };
type MeasureOptions = { random?: () => number; clock?: () => number; now?: () => Date;
  write?: (sample: PerfReceipt) => Promise<unknown> };

export function safePerformanceName(kind: PerformanceKind, name: string): boolean {
  return Object.hasOwn(PERFORMANCE_NAMES, kind) &&
    (PERFORMANCE_NAMES[kind] as readonly string[]).includes(name);
}

/** A failed observation cannot affect a business action's return value or thrown error. */
export async function measure<T>(
  kind: PerformanceKind, name: string, work: () => Promise<T>, options: MeasureOptions = {},
): Promise<T> {
  const clock = options.clock ?? Date.now;
  const start = clock();
  let ok = false;
  try {
    const result = await work();
    ok = true;
    return result;
  } finally {
    const sampled = kind === "JOB" || (options.random ?? Math.random)() < 0.1;
    if (sampled && safePerformanceName(kind, name)) {
      const elapsed = Math.max(0, Math.min(3_600_000, Math.round(clock() - start)));
      const row: PerfReceipt = { kind, name, ms: elapsed, ok, at: (options.now ?? (() => new Date()))() };
      try {
        if (options.write) await options.write(row);
        else await prisma.perfSample.create({ data: row });
      } catch {
        // Telemetry must not change a successful or failed domain operation.
      }
    }
  }
}

/** Deterministic nearest-rank percentile: rank = ceil(fraction * sample count). */
export function percentile(sorted: readonly number[], fraction: number): number | null {
  if (!sorted.length || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

export type ObservationWindow = "7d" | "30d";
export type ObservationRow = {
  kind: PerformanceKind; name: string; samples: number;
  status: "ENOUGH" | "NOT_ENOUGH_DATA" | "TRUNCATED"; message: string;
  p50Ms: number | null; p95Ms: number | null; errorRatePercent: number | null;
  previousSamples: number; previousP95Ms: number | null; p95ChangePercent: number | null;
};

/**
 * A bounded exact snapshot. If the cap was reached, do not pretend a partial
 * percentile is representative. Insufficient current samples also hide all guesses.
 */
export async function getObservations(input: {
  window: ObservationWindow; kind?: PerformanceKind; now?: Date;
}): Promise<{ window: ObservationWindow; start: string; end: string; rows: ObservationRow[]; truncated: boolean }> {
  const now = input.now ?? new Date();
  const days = input.window === "7d" ? 7 : input.window === "30d" ? 30 : null;
  if (!days || (input.kind && !Object.hasOwn(PERFORMANCE_NAMES, input.kind)))
    throw new Error("INVALID_OBSERVATION_WINDOW");
  const start = new Date(now.getTime() - days * 86_400_000);
  const previousStart = new Date(start.getTime() - days * 86_400_000);
  const samples = await prisma.perfSample.findMany({
    where: { at: { gte: previousStart, lt: now }, ...(input.kind ? { kind: input.kind } : {}) },
    select: { kind: true, name: true, ms: true, ok: true, at: true },
    orderBy: [{ at: "desc" }, { id: "desc" }], take: 10_001,
  });
  const truncated = samples.length > 10_000;
  const kinds = input.kind ? [input.kind] : Object.keys(PERFORMANCE_NAMES) as PerformanceKind[];
  const rows: ObservationRow[] = [];
  for (const kind of kinds) {
    for (const name of PERFORMANCE_NAMES[kind]) {
      const current = samples.filter(row => row.kind === kind && row.name === name && row.at >= start);
      const previous = samples.filter(row => row.kind === kind && row.name === name && row.at < start);
      const enough = !truncated && current.length >= 30;
      const currentSorted = enough ? current.map(row => row.ms).sort((a, b) => a - b) : [];
      const previousSorted = !truncated && previous.length >= 30
        ? previous.map(row => row.ms).sort((a, b) => a - b) : [];
      const p95 = percentile(currentSorted, 0.95);
      const priorP95 = percentile(previousSorted, 0.95);
      rows.push({
        kind, name, samples: current.length,
        status: truncated ? "TRUNCATED" : enough ? "ENOUGH" : "NOT_ENOUGH_DATA",
        message: truncated ? "Sampling window exceeded the safe read cap."
          : enough ? "Observed from stored samples."
          : "Not enough data yet",
        p50Ms: percentile(currentSorted, 0.5), p95Ms: p95,
        errorRatePercent: enough ? Math.round(current.filter(row => !row.ok).length * 10000 / current.length) / 100 : null,
        previousSamples: previous.length, previousP95Ms: priorP95,
        p95ChangePercent: p95 !== null && priorP95 !== null && priorP95 > 0
          ? Math.round((p95 - priorP95) * 10000 / priorP95) / 100 : null,
      });
    }
  }
  return { window: input.window, start: start.toISOString(), end: now.toISOString(), rows, truncated };
}

/** One bounded retention batch; the nightly sweep can call again on another date. */
export async function prunePerformanceSamples(now = new Date()): Promise<number> {
  const boundary = new Date(now.getTime() - 30 * 86_400_000);
  return prisma.$transaction(async tx => {
    const old = await tx.perfSample.findMany({
      where: { at: { lt: boundary } },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      select: { id: true }, take: 5_000,
    });
    if (!old.length) return 0;
    return (await tx.perfSample.deleteMany({ where: { id: { in: old.map(row => row.id) } } })).count;
  });
}
