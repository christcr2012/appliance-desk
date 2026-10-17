/**
 * Language is an explicitly customer-owned preference, not consent to receive
 * messages, acceptance of a contract, or approval of a Spanish legal translation.
 */
export type CustomerLanguage = "en" | "es";
export const CUSTOMER_LANGUAGES = ["en", "es"] as const;

export function parseCustomerLanguage(input: unknown): CustomerLanguage {
  return input === "es" ? "es" : "en";
}

/**
 * Translated copy is a DRAFT until IN-83's owner-selected fluent reviewer
 * approves. Never use a customer's preference to change what is legally signed.
 */
export function customerLanguageActive(
  preference: CustomerLanguage,
  reviewedAndPublished: boolean,
): CustomerLanguage {
  return reviewedAndPublished && preference === "es" ? "es" : "en";
}

/** A complete keyset avoids silent missing Spanish translations. */
export const customerStrings = {
  en: {
    language: "Language",
    english: "English",
    spanish: "Español",
    saveLanguage: "Save language",
    saved: "Language preference saved",
    translationPending: "Spanish customer documents are being reviewed. English remains the controlling agreement.",
    unavailable: "Your account could not be found. Contact our team.",
    estimateTitle: "Your estimate",
    estimateMissing: "This link isn't available",
    estimateReview: "Review your estimate",
    estimateApprove: "Approve estimate",
    estimateDecline: "Decline estimate",
    estimateQuestions: "Request changes",
    agreementTitle: "Review & sign your rental agreement",
    preparedFor: "Prepared for",
    serviceAddress: "Service address",
    monthlyRent: "Monthly rent",
    signAgreement: "Sign agreement",
    termsEnglish: "The signed English agreement controls. This translation is provided for convenience only.",
    paymentTitle: "Complete secure payment",
    paymentRedirect: "Your payment is handled securely by Stripe.",
    paymentFailed: "Payment was not completed. Try the secure link again or contact us.",
    portalTitle: "Your account",
    rentals: "Rentals",
    billing: "Billing",
    maintenance: "Maintenance",
    settings: "Settings",
    nextStep: "Next step",
    accountTitle: "Account",
    accountDescription: "Manage communication preferences and privacy requests.",
    privacyRequests: "Privacy requests",
    textNotices: "Text message notifications",
    offByDefault: "Off by default — you only receive texts if you turn this on.",
    support: "Contact support",
    messageGreeting: "Hello",
    messageLink: "Open your secure link",
    messageNoCard: "Never reply with a payment card number.",
    saveError: "Couldn't save your preference. Try again.",
  },
  es: {
    language: "Idioma",
    english: "English",
    spanish: "Español",
    saveLanguage: "Guardar idioma",
    saved: "Preferencia de idioma guardada",
    translationPending: "Estamos revisando los documentos en español. El contrato en inglés sigue siendo el que tiene validez.",
    unavailable: "No encontramos su cuenta. Comuníquese con nuestro equipo.",
    estimateTitle: "Su presupuesto",
    estimateMissing: "Este enlace no está disponible",
    estimateReview: "Revise su presupuesto",
    estimateApprove: "Aprobar presupuesto",
    estimateDecline: "Rechazar presupuesto",
    estimateQuestions: "Solicitar cambios",
    agreementTitle: "Revise y firme su contrato de alquiler",
    preparedFor: "Preparado para",
    serviceAddress: "Dirección de servicio",
    monthlyRent: "Alquiler mensual",
    signAgreement: "Firmar contrato",
    termsEnglish: "El contrato firmado en inglés prevalece. Esta traducción es únicamente informativa.",
    paymentTitle: "Completar el pago seguro",
    paymentRedirect: "Stripe procesa su pago de forma segura.",
    paymentFailed: "No se completó el pago. Intente nuevamente con el enlace seguro o comuníquese con nosotros.",
    portalTitle: "Su cuenta",
    rentals: "Alquileres",
    billing: "Facturación",
    maintenance: "Mantenimiento",
    settings: "Configuración",
    nextStep: "Siguiente paso",
    accountTitle: "Cuenta",
    accountDescription: "Administre sus preferencias de comunicación y solicitudes de privacidad.",
    privacyRequests: "Solicitudes de privacidad",
    textNotices: "Avisos por mensaje de texto",
    offByDefault: "Desactivados de forma predeterminada; solo recibe mensajes si los habilita.",
    support: "Contactar con soporte",
    messageGreeting: "Hola",
    messageLink: "Abra su enlace seguro",
    messageNoCard: "Nunca responda con un número de tarjeta de pago.",
    saveError: "No pudimos guardar su preferencia. Vuelva a intentarlo.",
  },
} as const;

export type CustomerStringKey = keyof typeof customerStrings.en;
export function customerText(language: CustomerLanguage, key: CustomerStringKey): string {
  return customerStrings[language][key];
}
