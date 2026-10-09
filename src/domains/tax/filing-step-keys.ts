import { createHash } from "node:crypto";

/** Bound to exact content, not position: changes invalidate old checkmarks. */
export function filingStepKeys(steps: string[]): string[] {
  const seen = new Map<string, number>();
  return steps.map(step => {
    const base = createHash("sha256").update(step).digest("hex").slice(0, 32);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `step:${base}:${occurrence}`;
  });
}

