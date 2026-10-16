import type { CustomerLanguage } from "./copy";

type QuoteNotice = {
  businessName: string;
  estimateNumber: number;
  recipientName: string | null;
  monthlyCents: number;
  oneTimeCents: number;
  fullyReviewed: boolean;
  clientMessage: string | null;
  url: string;
};

/** Human review is a distinct runtime gate; callers must pass the ACTIVE language,
 * never the unapproved preference. Money always comes from the identical snapshot. */
export function quoteEmailCopy(language: CustomerLanguage, quote: QuoteNotice) {
  const money = (cents: number) => (cents / 100).toFixed(2);
  if (language === "es") {
    return {
      subject: `Presupuesto n.º ${quote.estimateNumber} de ${quote.businessName}`,
      actionLabel: "Ver y responder al presupuesto",
      text: [
        `Hola${quote.recipientName ? ` ${quote.recipientName}` : ""},`,
        `${quote.businessName} preparó el presupuesto n.º ${quote.estimateNumber} para usted.`,
        quote.monthlyCents ? `Total mensual estimado: $${money(quote.monthlyCents)} por mes.` : "",
        quote.oneTimeCents ? `Cargos únicos estimados: $${money(quote.oneTimeCents)}.` : "",
        quote.fullyReviewed
          ? "El desglose revisado incluye las direcciones de servicio y separa lo que se debe al firmar del alquiler futuro."
          : "Este presupuesto es preliminar, no una oferta final vinculante. Pueden faltar cargos, entrega, impuestos y depósitos. No puede aceptar ni pagar hasta que el propietario envíe una oferta verificada.",
        quote.clientMessage ?? "",
        "Revise los detalles y responda en el enlace seguro:",
        quote.url,
      ].filter(Boolean).join("\n\n"),
    };
  }
  return {
    subject: `Estimate #${quote.estimateNumber} from ${quote.businessName}`,
    actionLabel: "View & respond to estimate",
    text: [
      `Hi${quote.recipientName ? ` ${quote.recipientName}` : ""},`,
      `${quote.businessName} has prepared estimate #${quote.estimateNumber} for you.`,
      quote.monthlyCents ? `Estimated recurring total: $${money(quote.monthlyCents)}/month.` : "",
      quote.oneTimeCents ? `Estimated one-time charges: $${money(quote.oneTimeCents)}.` : "",
      quote.fullyReviewed
        ? "The reviewed all-in breakdown includes each service address and separates the amount due at signing from future rent."
        : "This is preliminary, not an all-in binding offer. Setup, delivery, taxes, deposits or other charges may be missing. You cannot approve or pay until the owner sends a verified offer.",
      quote.clientMessage ?? "",
      "Review the details and let us know:",
      quote.url,
    ].filter(Boolean).join("\n\n"),
  };
}

export function followUpEmailCopy(
  language: CustomerLanguage,
  input: { name: string | null; businessName: string; number: number; url: string },
) {
  if (language === "es") return {
    subject: `Seguimiento del presupuesto n.º ${input.number} de ${input.businessName}`,
    text: [
      `Hola${input.name ? ` ${input.name}` : ""},`,
      `Hace unos días, ${input.businessName} le envió el presupuesto n.º ${input.number}. Queremos asegurarnos de que lo recibió.`,
      "¿Sigue interesado? Puede revisar y responder aquí sin iniciar sesión:",
      input.url,
      "Si cambiaron sus planes o tiene preguntas, responda a este correo.",
    ].join("\n\n"),
    actionLabel: "Ver y responder al presupuesto",
  };
  return {
    subject: `Estimate #${input.number} follow-up from ${input.businessName}`,
    text: [
      `Hi${input.name ? ` ${input.name}` : ""},`,
      `Just checking in — ${input.businessName} sent estimate #${input.number} a few days ago.`,
      "Still interested? Review and respond here without logging in:",
      input.url,
      "If your plans changed or you have questions, reply to this email.",
    ].join("\n\n"),
    actionLabel: "View & respond to estimate",
  };
}
