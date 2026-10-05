export function automationCounts(value: unknown): Record<string, number> {
  if (typeof value === "number" && Number.isFinite(value)) return { processed: Math.trunc(value) };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Array.isArray(value) ? { processed: value.length } : { completed: 1 };
  }

  const counts: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) counts[key] = Math.trunc(item);
    else if (Array.isArray(item)) counts[key] = item.length;
  }
  return Object.keys(counts).length > 0 ? counts : { completed: 1 };
}
