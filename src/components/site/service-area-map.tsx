import { HIGHWAYS, ZONE_COLOR_CLASSES, projectMiles } from "@/domains/delivery/map";
import type { TownWithZone } from "@/domains/delivery/towns";
import type { ZoneSettings } from "@/domains/delivery/zone";

export type ServiceAreaMapCopy = { title: string; north: string; scale: string; center: string };

/**
 * ZONE-1: our own drawing of the delivery zones (no map service, no script). Rings to scale from the zone settings,
 * the center, the main roads, the larger towns, a north arrow and a 10-mile scale bar. Scales to any width. The same
 * information is in the text list beside it (legend and towns by zone), so the drawing itself is one labelled image.
 */
export function ServiceAreaMap({ settings, towns, copy, id = "zone-map" }: {
  settings: Pick<ZoneSettings, "zones" | "maxMiles" | "center">;
  towns: readonly TownWithZone[];
  copy: ServiceAreaMapCopy;
  id?: string;
}) {
  const outer = Math.max(settings.maxMiles, ...settings.zones.map((zone) => zone.outerMiles));
  const r = Math.ceil(outer + 6);
  const titleId = `${id}-title`;
  const rings = settings.zones.map((zone, index) => ({ zone, index })).reverse();
  const shown = towns.filter((town) => town.label && town.miles > 0.5 && town.miles <= r - 2);
  const scaleMiles = 10;
  return (
    <figure className="m-0">
      <svg
        viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`}
        role="img"
        aria-labelledby={titleId}
        tabIndex={0}
        className="h-auto w-full rounded-card border border-hairline bg-surface focus-visible:outline-2 focus-visible:outline-offset-2"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{copy.title}</title>
        {rings.map(({ zone, index }) => (
          <circle key={index} cx={0} cy={0} r={zone.outerMiles}
            className={`${ZONE_COLOR_CLASSES[zone.color].fill} ${ZONE_COLOR_CLASSES[zone.color].stroke}`} strokeWidth={0.35} />
        ))}
        <g className="stroke-ink-faint" fill="none" strokeWidth={0.45} strokeLinecap="round" strokeLinejoin="round">
          {HIGHWAYS.map((road) => (
            <polyline key={road.name}
              points={road.points.map((point) => { const p = projectMiles(point, settings.center); return `${p.x},${p.y}`; }).join(" ")} />
          ))}
        </g>
        <g className="fill-ink-soft" fontSize={1.9} fontWeight={700}>
          {HIGHWAYS.map((road) => {
            const p = projectMiles(road.points[road.labelAt]!, settings.center);
            if (Math.abs(p.x) > r - 3 || Math.abs(p.y) > r - 3) return null;
            return <text key={road.name} x={p.x + 0.8} y={p.y - 0.8}>{road.name}</text>;
          })}
        </g>
        <g className="fill-ink" fontSize={2.1}>
          {shown.map((town) => {
            const p = projectMiles(town, settings.center);
            const anchor = p.x > r - 14 ? "end" : "start";
            return (
              <g key={town.slug}>
                <circle cx={p.x} cy={p.y} r={0.55} className="fill-ink" />
                <text x={anchor === "end" ? p.x - 1 : p.x + 1} y={p.y + 0.7} textAnchor={anchor}>{town.name}</text>
              </g>
            );
          })}
        </g>
        <g>
          <circle cx={0} cy={0} r={1.1} className="fill-primary stroke-surface" strokeWidth={0.4} />
          <text x={0} y={-2} textAnchor="middle" fontSize={2.3} fontWeight={800} className="fill-primary">{copy.center}</text>
        </g>
        <g transform={`translate(${r - 5} ${-r + 3})`} className="fill-ink">
          <path d="M0 0 L1.6 4.4 L0 3.4 L-1.6 4.4 Z" />
          <text x={0} y={7.2} textAnchor="middle" fontSize={2.3} fontWeight={800}>{copy.north}</text>
        </g>
        <g transform={`translate(${-r + 3} ${r - 4})`}>
          <line x1={0} y1={0} x2={scaleMiles} y2={0} className="stroke-ink" strokeWidth={0.5} />
          <line x1={0} y1={-0.8} x2={0} y2={0.8} className="stroke-ink" strokeWidth={0.5} />
          <line x1={scaleMiles} y1={-0.8} x2={scaleMiles} y2={0.8} className="stroke-ink" strokeWidth={0.5} />
          <text x={scaleMiles / 2} y={-1.4} textAnchor="middle" fontSize={1.9} className="fill-ink">{copy.scale}</text>
        </g>
      </svg>
    </figure>
  );
}
