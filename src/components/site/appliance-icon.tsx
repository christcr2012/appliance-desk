/**
 * Simple generic line-art illustrations — not photos of any real product,
 * brand, or model. Used across the public site in place of stock/product
 * photography, which we don't have real permission or real inventory
 * photos for yet (see the disclaimer wherever these appear: actual
 * appliances provided may vary in brand, model, and color). Purely
 * decorative, so aria-hidden — the surrounding text always carries the
 * actual meaning.
 */
export function ApplianceIcon({
  kind,
  className = "",
}: {
  kind: "washer" | "dryer" | "set";
  className?: string;
}) {
  if (kind === "set") {
    return (
      <svg
        viewBox="0 0 120 80"
        className={className}
        aria-hidden="true"
        fill="none"
      >
        <g transform="translate(2 4)">
          <ApplianceBody />
        </g>
        <g transform="translate(60 4)">
          <ApplianceBody dryer />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 60 80" className={className} aria-hidden="true" fill="none">
      <ApplianceBody dryer={kind === "dryer"} />
    </svg>
  );
}

function ApplianceBody({ dryer = false }: { dryer?: boolean }) {
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
      {dryer ? (
        <path
          d="M22 46a8 8 0 0 1 16 0"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.6"
        />
      ) : (
        <path
          d="M22 40l16 12M38 40l-16 12"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.6"
        />
      )}
    </>
  );
}
