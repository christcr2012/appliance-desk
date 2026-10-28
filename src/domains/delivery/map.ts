import type { GeoPoint, ZoneColor } from "./zone";

/**
 * ZONE-1: geometry for our own service-area map drawing (no map service). Positions are projected to miles east and
 * north of the center (an equirectangular projection, accurate to a fraction of a mile at this size), so the zone rings
 * are true circles to scale. SVG y grows downward, so north is negative y.
 */

const MILES_PER_DEGREE_LAT = 69.0;

export function projectMiles(point: GeoPoint, center: GeoPoint): { x: number; y: number } {
  const x = (point.lon - center.lon) * MILES_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180);
  const y = -(point.lat - center.lat) * MILES_PER_DEGREE_LAT;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

/** Main roads as simple lines through approximate points (public road knowledge; a drawing aid only). */
export const HIGHWAYS: ReadonlyArray<{ name: string; points: GeoPoint[]; labelAt: number }> = [
  { name: "I-25", labelAt: 3, points: [
    { lat: 39.74, lon: -104.99 }, { lat: 39.87, lon: -104.98 }, { lat: 40.1, lon: -104.98 }, { lat: 40.35, lon: -104.98 },
    { lat: 40.58, lon: -104.99 }, { lat: 40.72, lon: -105.0 }, { lat: 41.0, lon: -104.99 },
  ] },
  { name: "US-34", labelAt: 1, points: [
    { lat: 40.377, lon: -105.521 }, { lat: 40.398, lon: -105.075 }, { lat: 40.41, lon: -104.75 },
    { lat: 40.387, lon: -104.562 }, { lat: 40.25, lon: -103.8 },
  ] },
  { name: "US-85", labelAt: 2, points: [
    { lat: 39.8, lon: -104.93 }, { lat: 39.985, lon: -104.82 }, { lat: 40.215, lon: -104.823 },
    { lat: 40.4, lon: -104.69 }, { lat: 40.582, lon: -104.732 }, { lat: 40.706, lon: -104.783 }, { lat: 41.0, lon: -104.8 },
  ] },
  { name: "I-76", labelAt: 2, points: [
    { lat: 39.79, lon: -104.95 }, { lat: 40.073, lon: -104.643 }, { lat: 40.108, lon: -104.52 },
    { lat: 40.23, lon: -104.07 }, { lat: 40.25, lon: -103.8 },
  ] },
];

/** Design-token classes for each zone color (fill for the ring, stroke for its edge, swatch for the legend). */
export const ZONE_COLOR_CLASSES: Record<ZoneColor, { fill: string; stroke: string; swatch: string }> = {
  GREEN: { fill: "fill-success-soft", stroke: "stroke-success", swatch: "bg-success-soft border-success" },
  BLUE: { fill: "fill-info-soft", stroke: "stroke-info-ink", swatch: "bg-info-soft border-info-ink" },
  AMBER: { fill: "fill-warning-bg", stroke: "stroke-warning-ink", swatch: "bg-warning-bg border-warning-ink" },
  PURPLE: { fill: "fill-accent-soft", stroke: "stroke-accent-dark", swatch: "bg-accent-soft border-accent-dark" },
  GRAY: { fill: "fill-tint", stroke: "stroke-line-strong", swatch: "bg-tint border-line-strong" },
};

/** "0–15", "15–30": the distance words for zone `index` (0-based). */
export function zoneRangeWords(zones: ReadonlyArray<{ outerMiles: number }>, index: number): string {
  const from = index === 0 ? 0 : zones[index - 1]!.outerMiles;
  const to = zones[index]!.outerMiles;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return `${fmt(from)}–${fmt(to)}`;
}
