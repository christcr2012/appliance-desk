import type { ActionSpec } from "./types";

// The class string for an ActionButton look, split out of action-button.tsx
// (a "use client" module) so server components can call it too: calling a
// client module's function from the server throws at render time. The
// portal Home's needs-you buttons are plain form/link elements styled with
// this helper. action-button.tsx re-exports it for existing importers.
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-field font-bold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60";
const SIZE = { md: "min-h-11 px-4 text-[15px] lg:min-h-10", lg: "min-h-12 px-5 text-base" } as const;
const VARIANT = {
  primary: "bg-primary text-on-primary hover:bg-primary-dark",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-tint",
} as const;

export function actionButtonClass({
  spec,
  size = "md",
  variant,
  className,
}: {
  spec: ActionSpec;
  size?: "md" | "lg";
  variant?: "primary" | "secondary";
  className?: string;
}): string {
  const look = variant ?? (spec.primary ? "primary" : "secondary");
  return [BASE, SIZE[size], VARIANT[look], className].filter(Boolean).join(" ");
}
