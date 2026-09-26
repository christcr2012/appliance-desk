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
 */
export function ApplianceMedia({
  photoUrl,
  name,
  className = "",
  iconClassName = "",
}: {
  photoUrl: string | null | undefined;
  name: string;
  className?: string;
  iconClassName?: string;
}) {
  if (photoUrl) {
    return (
      // External, owner-supplied URL of arbitrary origin — see docs/DECISIONS.md.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={`A basic ${name.toLowerCase()} — the unit you receive may vary in brand, model, and color`}
        className={className}
      />
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
