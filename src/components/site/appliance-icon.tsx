import Image from "next/image";

/**
 * Simple generic line-art illustrations — not photos of any real product,
 * brand, or model. This is the fallback shown for any appliance type that
 * doesn't have a real photo yet (ApplianceType.photoUrl is null) — see
 * <ApplianceMedia> below, which is what pages should actually render.
 * Purely decorative, so aria-hidden — the surrounding text always
 * carries the actual meaning.
 *
 * Deliberately generic (one silhouette, not a per-appliance drawing): a
 * previous version tried to guess "washer" vs. "dryer" vs. "set" from
 * the type's slug, which broke the moment a new appliance category
 * (e.g. a refrigerator) was added — it just kept showing a washer icon.
 * A single neutral box-with-a-door icon has no such trap.
 */
export function ApplianceIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 80" className={className} aria-hidden="true" fill="none">
      <ApplianceBody />
    </svg>
  );
}

/**
 * Renders a real photo when the appliance type has one (photoUrl set in
 * /desk/settings), otherwise falls back to the generic icon. This is
 * what pricing/home pages should use instead of <ApplianceIcon> directly
 * — see docs/ROADMAP.md for swapping in real photos.
 *
 * Uses next/image (added 2026-09-29, part of the mobile-performance pass
 * — docs/DECISIONS.md), not a plain <img>: every photoUrl here comes
 * from src/components/photo-upload-field.tsx, which always uploads to
 * this app's own Vercel Blob store (now allow-listed in
 * next.config.ts's images.remotePatterns), so it's always safe to
 * optimize. This is what actually shrinks the file that ships to a
 * phone — a same real photo Chris uploads straight from his camera can
 * be several megabytes; next/image resizes it to what the layout needs
 * and serves it as WebP/AVIF automatically, and only loads it once it's
 * about to scroll into view instead of eagerly on every page load.
 */
export function ApplianceMedia({
  photoUrl,
  name,
  alt,
  className = "",
  iconClassName = "",
}: {
  photoUrl: string | null | undefined;
  name: string;
  /** Picture description; the standard sentence is used when omitted. */
  alt?: string;
  className?: string;
  iconClassName?: string;
}) {
  if (photoUrl) {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <Image
          src={photoUrl}
          alt={alt ?? `A basic ${name.toLowerCase()} — the unit you receive may vary in brand, model, and color`}
          fill
          sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw"
          className="object-cover"
        />
      </div>
    );
  }
  return <ApplianceIcon className={iconClassName || className} />;
}

function ApplianceBody() {
  return (
    <>
      <rect
        x="2"
        y="2"
        width="56"
        height="72"
        rx="6"
        stroke="currentColor"
        strokeWidth="3"
      />
      <rect x="10" y="10" width="16" height="6" rx="2" fill="currentColor" opacity="0.5" />
      <circle cx="30" cy="46" r="20" stroke="currentColor" strokeWidth="3" />
      <circle cx="30" cy="46" r="13" stroke="currentColor" strokeWidth="2" opacity="0.6" />
      <path
        d="M22 40l16 12M38 40l-16 12"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.6"
      />
    </>
  );
}
