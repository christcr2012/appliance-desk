import type { CSSProperties } from "react";

export const CROP_SHAPES = [
  { key: "wide", label: "Wide banner", ratio: "16 / 9" },
  { key: "square", label: "Square card", ratio: "1 / 1" },
  { key: "tall", label: "Phone, tall", ratio: "4 / 5" },
] as const;

/**
 * Shows an owner how one picture will be cropped in each place it can appear, using the chosen focal point.
 * Plain pictures only; a decorative picture is labelled so nobody expects spoken text for it.
 */
export function ImageCropPreview({
  src,
  alt,
  decorative = false,
  focalX = 50,
  focalY = 50,
}: {
  src: string;
  alt: string;
  decorative?: boolean;
  focalX?: number;
  focalY?: number;
}) {
  const position = `${clamp(focalX)}% ${clamp(focalY)}%`;
  return (
    <figure aria-label="How this picture will be cropped" style={{ margin: 0 }}>
      <ul style={{ display: "flex", flexWrap: "wrap", gap: 16, listStyle: "none", margin: 0, padding: 0 }}>
        {CROP_SHAPES.map((shape) => (
          <li key={shape.key} style={{ width: 160 }}>
            <div
              style={{ aspectRatio: shape.ratio, overflow: "hidden", borderRadius: 8, border: "1px solid currentColor" } as CSSProperties}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- owner-only preview of a private draft picture */}
              <img
                src={src}
                alt={decorative ? "" : alt}
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: position, display: "block" }}
              />
            </div>
            <figcaption>{shape.label}</figcaption>
          </li>
        ))}
      </ul>
      {decorative ? <p>This picture is marked decorative, so screen readers skip it.</p> : null}
    </figure>
  );
}

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50;
}
