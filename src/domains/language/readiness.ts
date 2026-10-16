export const CUSTOMER_SPANISH_SURFACE_READINESS = {
  quote: false,
  agreement: false,
  signing: false,
  payment: false,
  portal: false,
  messages: false,
  ownerTemplates: false,
} as const;

export const allSpanishSurfacesReady =
  Object.values(CUSTOMER_SPANISH_SURFACE_READINESS).every(Boolean);


