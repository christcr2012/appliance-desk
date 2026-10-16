import type { CustomerLanguage } from "@/domains/language/copy";

import type { StatusTone } from "@/components/status-badge";

/**
 * Plain-English labels for the database's internal status/type codes,
 * for anywhere a CUSTOMER sees one (the owner desk's staff can read
 * "AWAITING_SIGNATURE" fine — this is specifically for /account/**,
 * per the design review's finding, 2026-09-27: customers were seeing
 * raw codes like "AWAITING_SIGNATURE" instead of a real sentence,
 * which reads like unfinished software).
 *
 * Deliberately just a lookup table, not a database change — the enum
 * values themselves stay exactly as Prisma/the rest of the app already
 * use them (see prisma/schema.prisma); this only changes what's shown
 * on screen.
 */

const RENTAL_AGREEMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Being set up",
  AWAITING_SIGNATURE: "Waiting on your signature",
  SCHEDULED: "Signed, starts later",
  ACTIVE: "Active",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const JOB_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "Delivery",
  INSTALLATION: "Installation",
  SWAP: "Swap",
  MAINTENANCE_VISIT: "Maintenance visit",
  REMOVAL: "Pickup / removal",
};

const MAINTENANCE_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  REVIEWING: "Being reviewed",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Being prepared",
  OPEN: "Open",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  FAILED: "Payment failed",
  VOID: "Voided",
  DELINQUENT: "Past due",
  WRITTEN_OFF: "Written off",
  REFUNDED: "Refunded",
};

const ESTIMATE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Being prepared",
  SENT: "Sent — awaiting your response",
  VIEWED: "Sent — awaiting your response",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CONVERTED: "Approved and set up",
};

export const SPANISH_STATUS_LABELS: Record<string, string> = {
  "Being set up": "En preparación",
  "Waiting on your signature": "Pendiente de su firma",
  "Signed, starts later": "Firmado, comienza después",
  "Active": "Activo",
  "Ended": "Finalizado",
  "Cancelled": "Cancelado",
  "Scheduled": "Programado",
  "In progress": "En curso",
  "Completed": "Completado",
  "Delivery": "Entrega",
  "Installation": "Instalación",
  "Swap": "Intercambio",
  "Maintenance visit": "Visita de mantenimiento",
  "Pickup / removal": "Recogida",
  "Submitted": "Enviado",
  "Being reviewed": "En revisión",
  "Resolved": "Resuelto",
  "Closed": "Cerrado",
  "Being prepared": "En preparación",
  "Open": "Pendiente",
  "Partially paid": "Pagado parcialmente",
  "Paid": "Pagado",
  "Payment failed": "Pago fallido",
  "Voided": "Anulado",
  "Past due": "Vencido",
  "Written off": "Dado de baja",
  "Refunded": "Reembolsado",
  "Sent — awaiting your response": "Enviado; pendiente de su respuesta",
  "Approved": "Aprobado",
  "Changes requested": "Cambios solicitados",
  "Declined": "Rechazado",
  "Expired": "Vencido",
  "Approved and set up": "Aprobado y preparado"
};

function lookup(labels: Record<string, string>, value: string, language: CustomerLanguage = "en"): string {
  const english = labels[value];
  return language === "es" ? (SPANISH_STATUS_LABELS[english] ?? "Estado no disponible") : (english ?? value);
}

export const rentalAgreementStatusLabel = (status: string, language: CustomerLanguage = "en") =>
  lookup(RENTAL_AGREEMENT_STATUS_LABELS, status, language);

const RENTAL_AGREEMENT_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "pending",
  AWAITING_SIGNATURE: "progress",
  SCHEDULED: "progress",
  ACTIVE: "success",
  ENDED: "stopped",
  CANCELLED: "stopped",
};

export const rentalAgreementStatusTone = (status: string): StatusTone =>
  RENTAL_AGREEMENT_STATUS_TONE[status] ?? "pending";

export const jobStatusLabel = (status: string, language: CustomerLanguage = "en") => lookup(JOB_STATUS_LABELS, status, language);

export const jobTypeLabel = (type: string, language: CustomerLanguage = "en") => lookup(JOB_TYPE_LABELS, type, language);

const JOB_STATUS_TONE: Record<string, StatusTone> = {
  SCHEDULED: "pending",
  IN_PROGRESS: "progress",
  COMPLETED: "success",
  CANCELLED: "stopped",
};

export const jobStatusTone = (status: string): StatusTone => JOB_STATUS_TONE[status] ?? "pending";

export const maintenanceStatusLabel = (status: string, language: CustomerLanguage = "en") =>
  lookup(MAINTENANCE_STATUS_LABELS, status, language);

export const invoiceStatusLabel = (status: string, language: CustomerLanguage = "en") => lookup(INVOICE_STATUS_LABELS, status, language);

export const estimateStatusLabel = (status: string, language: CustomerLanguage = "en") => lookup(ESTIMATE_STATUS_LABELS, status, language);

// Which of the 5 shared status icons (src/components/status-badge.tsx)
// each status maps to — one lookup shared by every page that shows an
// Invoice status, instead of each page keeping its own copy (2026-09-29,
// "finish the icon set" — this exact duplication, between
// /desk/billing and a customer's own billing page, is what prompted
// pulling it out here).
const INVOICE_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "pending",
  OPEN: "progress",
  PARTIALLY_PAID: "progress",
  PAID: "success",
  FAILED: "stopped",
  VOID: "stopped",
  DELINQUENT: "attention",
  WRITTEN_OFF: "stopped",
  REFUNDED: "pending",
};

export const invoiceStatusTone = (status: string): StatusTone => INVOICE_STATUS_TONE[status] ?? "pending";
