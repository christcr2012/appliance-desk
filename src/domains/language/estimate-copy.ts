import type { CustomerLanguage } from "./copy";

export const ESTIMATE_COPY = {
  en: {
    estimate: "Estimate",
    preparedFor: "Prepared for",
    disclaimer: "These estimate line items are preliminary rental and one-time figures, not a finalized all-in signing price. Mandatory setup charges, location taxes, down payments and other fees must be separately reviewed before signing a binding rental agreement.",
    recurring: "per month",
    oneTime: "one-time",
    approvalUnavailable: "The reviewed all-in offer needs to be refreshed before approval. Please request changes or contact the business. Preliminary figures are not binding.",
    finalReviewTitle: "Your complete order price is being reviewed",
    finalReviewBody: "An all-in signing total is not yet available for every address. Contact the business before treating preliminary figures as final. No amount here proves payment or a confirmed delivery.",
    approved: "You approved this estimate.",
    requestedChanges: "We received your request for changes.",
    changesFollowup: "We'll follow up with a revised estimate.",
    declined: "This estimate was declined.",
    expired: "This estimate has expired. Contact us if you'd still like to move forward.",
    finalized: "This estimate was approved and is being set up.",
    depositDue: "Deposit checkout needs a renewed, verified complete signing order.",
    noSeparateDeposit: "The refundable reserve is included in the reviewed signing amount. Review and sign the agreement before paying. No separate estimate deposit is due.",
    nextSteps: "We'll be in touch about next steps.",
  },
  es: {
    estimate: "Presupuesto",
    preparedFor: "Preparado para",
    disclaimer: "Estas líneas son importes preliminares del alquiler y de cargos únicos; no son el precio total final para firmar. Los cargos de instalación, impuestos de la dirección, anticipos y otros importes deben revisarse por separado antes de firmar un contrato vinculante.",
    recurring: "por mes",
    oneTime: "una sola vez",
    approvalUnavailable: "La oferta revisada con todos los cargos debe actualizarse antes de aceptarla. Solicite cambios o comuníquese con la empresa. Los importes preliminares no son vinculantes.",
    finalReviewTitle: "Estamos revisando el precio total de su pedido",
    finalReviewBody: "Todavía no hay un importe total para firmar en todas las direcciones. Consulte a la empresa antes de considerar finales los importes preliminares. Ninguna cifra aquí confirma un pago ni una entrega programada.",
    approved: "Ha aprobado este presupuesto.",
    requestedChanges: "Recibimos su solicitud de cambios.",
    changesFollowup: "Le enviaremos un presupuesto revisado.",
    declined: "Este presupuesto fue rechazado.",
    expired: "Este presupuesto venció. Comuníquese con nosotros si aún desea continuar.",
    finalized: "Este presupuesto fue aprobado y lo estamos preparando.",
    depositDue: "El pago del depósito requiere un pedido completo y verificado nuevamente.",
    noSeparateDeposit: "La reserva reembolsable está incluida en el importe revisado para la firma. Revise y firme el contrato antes de pagar. No se debe pagar otro depósito para este presupuesto.",
    nextSteps: "Nos comunicaremos con usted para los próximos pasos.",
  },
} as const;

export type EstimateKey = keyof typeof ESTIMATE_COPY.en;
export function estimateCopy(language: CustomerLanguage, key: EstimateKey): string {
  return ESTIMATE_COPY[language][key];
}
