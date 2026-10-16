import type { CustomerLanguage } from "./copy";

export const PORTAL_TRANSLATIONS = {
  "Welcome": "Bienvenido",
  "No rental account attached to this login": "No hay una cuenta de alquiler vinculada a este acceso",
  "Contact the business if you expected to see an active rental.": "Comuníquese con la empresa si esperaba ver un alquiler activo.",
  "Contact the business if you expected to see billing history here.": "Comuníquese con la empresa si esperaba encontrar aquí su historial de facturación.",
  "Your rental account": "Su cuenta de alquiler",
  "Your rentals, next visit, billing and help in one place.": "Sus alquileres, próxima visita, facturación y ayuda en un solo lugar.",
  "Account properties": "Propiedades de la cuenta",
  "What do I rent?": "¿Qué tengo alquilado?",
  "No active rentals": "No hay alquileres activos",
  "An agreement awaiting signature or delivery may still be in progress.": "Un contrato pendiente de firma o entrega puede seguir en proceso.",
  "What's next?": "¿Qué sigue?",
  "No scheduled visit": "No hay visitas programadas",
  "Do I owe anything?": "¿Tengo algún saldo pendiente?",
  "Invoice amounts are separate from your rental rate and may include deposits, fees or tax.": "Las facturas son distintas del alquiler y pueden incluir depósitos, cargos o impuestos.",
  "How do I get help?": "¿Cómo solicito ayuda?",
  "Billing": "Facturación",
  "Update your payment method and review your recorded invoice history.": "Actualice su método de pago y consulte el historial de facturas.",
  "Payment method": "Método de pago",
  "Stripe opens a secure billing page for card or bank-account changes.": "Stripe abre una página segura para cambiar la tarjeta o cuenta bancaria.",
  "No invoices yet": "Todavía no hay facturas",
  "An invoice is created automatically each time you're billed.": "Se crea automáticamente una factura cada vez que se le cobra.",
  "Invoices": "Facturas",
  "My rentals": "Mis alquileres",
  "Maintenance": "Mantenimiento",
  "Account": "Cuenta",
  "Manage communication preferences and privacy requests.": "Administre sus preferencias de comunicación y solicitudes de privacidad.",
  "Text message notifications": "Notificaciones por mensaje de texto",
  "Off by default — you only get texts if you turn this on.": "Desactivadas de forma predeterminada; solo recibirá mensajes si las habilita.",
  "Privacy requests": "Solicitudes de privacidad",
  "No rental account found": "No se encontró una cuenta de alquiler",
  "Contact the business if you expected to manage account settings here.": "Comuníquese con la empresa si esperaba administrar la configuración de su cuenta.",
} as const;

export type PortalLabel = keyof typeof PORTAL_TRANSLATIONS;
export function portalLabel(language: CustomerLanguage, english: PortalLabel): string {
  return language === "es" ? PORTAL_TRANSLATIONS[english] : english;
}
