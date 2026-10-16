/** W-26 consumer implementations now have bilingual source/rendering coverage.
 * This declares implementation coverage only: runtime additionally requires every
 * exact owner source, current fluent/legal evidence and explicit owner publication.
 * The whole subsection stays unaccepted until final DB/browser/CI review passes.
 */
export const CUSTOMER_SPANISH_SURFACE_READINESS = {
  quote: true,
  agreement: true,
  signing: true,
  payment: true,
  portal: true,
  messages: true,
  ownerTemplates: true,
} as const;

export const allSpanishSurfacesReady =
  Object.values(CUSTOMER_SPANISH_SURFACE_READINESS).every(Boolean);


