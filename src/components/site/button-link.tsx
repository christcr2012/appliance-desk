import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "outline";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-dark active:bg-primary-dark",
  secondary:
    "bg-accent text-on-primary hover:bg-accent-dark active:bg-accent-dark",
  outline:
    "border-2 border-ink/20 text-ink hover:border-primary hover:text-primary bg-transparent",
};

/**
 * A <Link> styled as a button. Real links (not buttons that navigate via
 * onClick) so middle-click/open-in-new-tab/right-click all work as users
 * expect — a common best-practice site convention.
 */
export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-base font-semibold shadow-sm transition-colors duration-150 ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}
