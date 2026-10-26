import type { CustomerLanguage } from "./copy";
import { formatMoney as formatCents } from "@/lib/money-ui";

/** Included in the fluent/legal fingerprint; all placeholders are substituted once. */
export const TRANSACTIONAL_COPY = {
  "en": {
    "quoteSubject": "Estimate #{{number}} from {{business}}",
    "quoteHello": "Hi{{name}},",
    "quoteIntro": "{{business}} has prepared estimate #{{number}} for you.",
    "monthly": "Estimated recurring total: {{amount}}/month.",
    "once": "Estimated one-time charges: {{amount}}.",
    "reviewed": "The reviewed all-in breakdown includes each service address and separates the amount due at signing from future rent.",
    "preliminary": "This is preliminary, not an all-in binding offer. Setup, delivery, taxes, deposits or other charges may be missing. You cannot approve or pay until the owner sends a verified offer.",
    "quoteLink": "Review the details and let us know:",
    "quoteAction": "View & respond to estimate",
    "followSubject": "Estimate #{{number}} follow-up from {{business}}",
    "followIntro": "Just checking in — {{business}} sent estimate #{{number}} a few days ago.",
    "followLink": "Still interested? Review and respond here without logging in:",
    "followReply": "If your plans changed or you have questions, reply to this email.",
    "billingSubject": "Your upcoming payment",
    "billingIntro": "Your next rental payment is scheduled for {{date}}{{amount}}. No action is needed — this will be charged automatically to the payment method on file.",
    "billingApprox": " for approximately {{amount}}",
    "billingReply": "If anything about your rental has changed, or you have questions, just reply to this email.",
    "lateNoticeSubject": "Your payment is late",
    "lateNoticeIntro": "Your payment of {{amount}} for bill #{{number}} was due {{due}} and has not been paid. If it is not paid by {{feeDate}}, a late fee of {{fee}} will be added to your next bill (once for this bill; it can be waived).",
    "lateNoticeRetry": "Your last payment for this bill did not go through, so the date has moved. Please try again.",
    "lateNoticePay": "Pay now:",
    "referralSubject": "You've got a referral credit",
    "referralCredit": "A {{amount}} credit has been added to your account{{next}}.",
    "referralNext": " and will automatically reduce your next payment",
    "referralThanks": "Thanks for being part of our referral program!",
    "privacySubject": "Verify your privacy request",
    "privacyIntro": "We received a request about your personal information. Use the link below within 48 hours to verify that request.",
    "privacyIgnore": "If you did not make this request, you can ignore this message.",
    "privacyAction": "Verify privacy request",
    "passwordSubject": "Set your Appliance Desk password",
    "passwordIntro": "Use the link below to set your password for Appliance Desk. This link expires in 1 hour and can only be used once.",
    "passwordIgnore": "If you didn't request this, you can safely ignore this email — your password won't change.",
    "passwordAction": "Set my password",
    "verifySubject": "Verify your Appliance Desk email address",
    "verifyIntro": "Use the link below to verify your email address for Appliance Desk. This link expires in 1 hour and can only be used once.",
    "verifyIgnore": "If you didn't request this, you can safely ignore this email.",
    "verifyAction": "Verify my email"
  },
  "es": {
    "quoteSubject": "Presupuesto n.º {{number}} de {{business}}",
    "quoteHello": "Hola{{name}},",
    "quoteIntro": "{{business}} preparó el presupuesto n.º {{number}} para usted.",
    "monthly": "Total mensual estimado: {{amount}} por mes.",
    "once": "Cargos únicos estimados: {{amount}}.",
    "reviewed": "El desglose revisado incluye las direcciones de servicio y separa lo que se debe al firmar del alquiler futuro.",
    "preliminary": "Este presupuesto es preliminar, no una oferta final vinculante. Pueden faltar cargos, entrega, impuestos y depósitos. No puede aceptar ni pagar hasta que el propietario envíe una oferta verificada.",
    "quoteLink": "Revise los detalles y responda en el enlace seguro:",
    "quoteAction": "Ver y responder al presupuesto",
    "followSubject": "Seguimiento del presupuesto n.º {{number}} de {{business}}",
    "followIntro": "Hace unos días, {{business}} le envió el presupuesto n.º {{number}}. Queremos asegurarnos de que lo recibió.",
    "followLink": "¿Sigue interesado? Puede revisar y responder aquí sin iniciar sesión:",
    "followReply": "Si cambiaron sus planes o tiene preguntas, responda a este correo.",
    "billingSubject": "Su próximo pago",
    "billingIntro": "Su próximo pago de alquiler está programado para el {{date}}{{amount}}. No necesita hacer nada; se cobrará automáticamente al método de pago registrado.",
    "billingApprox": " por aproximadamente {{amount}}",
    "billingReply": "Si su alquiler ha cambiado o tiene preguntas, responda a este correo.",
    "lateNoticeSubject": "Su pago está atrasado",
    "lateNoticeIntro": "Su pago de {{amount}} de la factura n.º {{number}} vencía el {{due}} y no se ha pagado. Si no se paga antes del {{feeDate}}, se agregará un cargo por pago tardío de {{fee}} a su próxima factura (una sola vez por esta factura; se puede perdonar).",
    "lateNoticeRetry": "Su último pago de esta factura no se completó, por lo que la fecha cambió. Por favor, inténtelo de nuevo.",
    "lateNoticePay": "Pague ahora:",
    "referralSubject": "Tiene un crédito por recomendación",
    "referralCredit": "Se agregó un crédito de {{amount}} a su cuenta{{next}}.",
    "referralNext": " que reducirá automáticamente su próximo pago",
    "referralThanks": "¡Gracias por participar en nuestro programa de recomendaciones!",
    "privacySubject": "Verifique su solicitud de privacidad",
    "privacyIntro": "Recibimos una solicitud sobre sus datos personales. Use el enlace a continuación dentro de 48 horas para verificarla.",
    "privacyIgnore": "Si no realizó esta solicitud, puede ignorar este mensaje.",
    "privacyAction": "Verificar solicitud de privacidad",
    "passwordSubject": "Establezca su contraseña de Appliance Desk",
    "passwordIntro": "Use el enlace siguiente para establecer su contraseña de Appliance Desk. Este enlace caduca en una hora y solo se puede usar una vez.",
    "passwordIgnore": "Si no solicitó esto, puede ignorar este correo; su contraseña no cambiará.",
    "passwordAction": "Establecer mi contraseña",
    "verifySubject": "Verifique su dirección de correo de Appliance Desk",
    "verifyIntro": "Use el enlace siguiente para verificar su dirección de correo de Appliance Desk. Este enlace caduca en una hora y solo se puede usar una vez.",
    "verifyIgnore": "Si no solicitó esto, puede ignorar este correo.",
    "verifyAction": "Verificar mi correo"
  }
} as const;
export type MessageCatalog = { [K in keyof typeof TRANSACTIONAL_COPY.en]: string };
export function messageText(language: CustomerLanguage, key: keyof typeof TRANSACTIONAL_COPY.en, values: Record<string,string> = {}, catalog: MessageCatalog = TRANSACTIONAL_COPY[language]) {
  return catalog[key].replace(/\{\{([a-z]+)\}\}/g, (_match, name: string) => {
    if (!Object.hasOwn(values, name)) throw new Error("Missing customer message variable");
    return values[name];
  });
}
type QuoteNotice = { businessName: string; estimateNumber: number; recipientName: string | null;
  monthlyCents: number; oneTimeCents: number; fullyReviewed: boolean; clientMessage: string | null; url: string };
export function quoteEmailCopy(language: CustomerLanguage, quote: QuoteNotice, catalog: MessageCatalog = TRANSACTIONAL_COPY[language]) {
  const t = (key: keyof typeof TRANSACTIONAL_COPY.en, values?: Record<string,string>) => messageText(language,key,values,catalog);
  return { subject: t("quoteSubject",{number:String(quote.estimateNumber),business:quote.businessName}),
    actionLabel:t("quoteAction"), text:[t("quoteHello",{name:quote.recipientName ? " "+quote.recipientName : ""}),
      t("quoteIntro",{business:quote.businessName,number:String(quote.estimateNumber)}),
      quote.monthlyCents ? t("monthly",{amount:formatCents(quote.monthlyCents)}) : "",
      quote.oneTimeCents ? t("once",{amount:formatCents(quote.oneTimeCents)}) : "",
      t(quote.fullyReviewed ? "reviewed" : "preliminary"), quote.clientMessage ?? "", t("quoteLink"), quote.url,
    ].filter(Boolean).join("\n\n") };
}
export function followUpEmailCopy(language: CustomerLanguage, input: {name:string|null;businessName:string;number:number;url:string}, catalog: MessageCatalog = TRANSACTIONAL_COPY[language]) {
  const t = (key: keyof typeof TRANSACTIONAL_COPY.en, values?: Record<string,string>) => messageText(language,key,values,catalog);
  return { subject:t("followSubject",{number:String(input.number),business:input.businessName}), actionLabel:t("quoteAction"),
    text:[t("quoteHello",{name:input.name ? " "+input.name : ""}),t("followIntro",{business:input.businessName,number:String(input.number)}),t("followLink"),input.url,t("followReply")].join("\n\n") };
}
