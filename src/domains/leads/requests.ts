/**
 * Lead appliance requests in words. A set (rental package, W-16A) is stored as one request row per machine type with
 * the same packageId, so every older reader still sees real machine types; this puts the set back together for people:
 * "1x Washer + Dryer Set, 2x Refrigerator". Pure — safe anywhere.
 */
type RequestRow = {
  quantity: number;
  applianceType: { name: string };
  package?: { id: string; name: string } | null;
};

export function summarizeApplianceRequests(requests: RequestRow[], separator = "x "): string {
  const parts: string[] = [];
  const seenPackages = new Set<string>();
  for (const request of requests) {
    if (request.package) {
      if (seenPackages.has(request.package.id)) continue;
      seenPackages.add(request.package.id);
      const rows = requests.filter((r) => r.package?.id === request.package?.id);
      const sets = Math.min(...rows.map((r) => r.quantity));
      parts.push(`${sets}${separator}${request.package.name}`);
    } else {
      parts.push(`${request.quantity}${separator}${request.applianceType.name}`);
    }
  }
  return parts.join(", ");
}
