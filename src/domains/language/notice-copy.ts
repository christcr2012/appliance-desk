export const NOTICE_COPY = {
  "en": {
    "annual:subject": "Your month-to-month rental with {{businessName}} continues: yearly reminder",
    "annual:body": "Your month-to-month rental with {{businessName}} ({{items}}) continues automatically each month at {{monthlyTotal}} a month plus any sales tax. On {{boundaryDate}} it will have been rented continuously for {{years}} year(s). You don't need to do anything to keep it. To end it, use the \"My rentals\" page of your customer account or contact us at {{businessPhone}} or {{businessEmail}}; your rental then ends on the first billing date at least {{noticeDays}} days later.",
    "change:subject": "A change to the terms of your month-to-month rental with {{businessName}}",
    "change:body": "Starting {{effectiveDate}}, these terms will apply to your month-to-month rental with {{businessName}}: {{terms}} You need at least {{noticeDays}} days' notice to end a month-to-month rental. Fixed-term leases (6 or 12 months) are not affected by this change. You can end your rental at any time from the \"My rentals\" page of your customer account, or by contacting us at {{businessPhone}} or {{businessEmail}}.",
    "renewal:subject": "Your rental renews automatically after {{endDate}}",
    "renewal:body": "This is a reminder from {{businessName}}. Your {{termMonths}}-month rental ({{items}}) ends on {{endDate}}. You chose automatic renewal, so unless you cancel it, your rental will continue month to month starting {{startDate}} at {{monthlyTotal}} a month (plus any sales tax). Nothing changes about your equipment.\n\nThe renewal terms you agreed to:\n{{terms}}\n\nTo stop the renewal, turn off automatic renewal on the “My rentals” page of your customer account, or contact us before {{endDate}}: {{businessPhone}} or {{businessEmail}}."
  },
  "es": {
    "annual:subject": "Su alquiler mes a mes con {{businessName}} continúa: recordatorio anual",
    "annual:body": "Su alquiler mes a mes con {{businessName}} ({{items}}) continúa automáticamente cada mes por {{monthlyTotal}} más los impuestos de ventas correspondientes. El {{boundaryDate}} habrá completado {{years}} año(s) continuos de alquiler. No necesita hacer nada para continuarlo. Para finalizarlo, use “Mis alquileres” en su cuenta o comuníquese al {{businessPhone}} o {{businessEmail}}; finalizará en la primera fecha de facturación que ocurra al menos {{noticeDays}} días después.",
    "change:subject": "Cambio en las condiciones de su alquiler mes a mes con {{businessName}}",
    "change:body": "A partir de {{effectiveDate}}, estas condiciones se aplicarán a su alquiler mes a mes con {{businessName}}: {{terms}} Se requieren al menos {{noticeDays}} días de aviso para finalizar un alquiler mes a mes. Este cambio no afecta los contratos de plazo fijo (6 o 12 meses). Puede solicitar finalizar el alquiler desde “Mis alquileres” en su cuenta o comunicándose al {{businessPhone}} o {{businessEmail}}.",
    "renewal:subject": "Su alquiler se renueva automáticamente después del {{endDate}}",
    "renewal:body": "Este es un recordatorio de {{businessName}}. Su alquiler de {{termMonths}} meses ({{items}}) finaliza el {{endDate}}. Eligió la renovación automática; salvo que la cancele, su alquiler continuará mes a mes desde el {{startDate}} por {{monthlyTotal}} al mes más los impuestos de ventas correspondientes. Su equipo no cambia.\n\nLas condiciones de renovación aceptadas:\n{{terms}}\n\nPara detener la renovación, desactívela desde “Mis alquileres” en su cuenta o comuníquese antes del {{endDate}} al {{businessPhone}} o {{businessEmail}}."
  }
} as const;
export type NoticeCopyKey = keyof typeof NOTICE_COPY.en;

export const NOTICE_WRAPPER_COPY = {
  greeting:"Hola {{customerName}},", controlling:"El texto registrado en inglés prevalece:",
  effective:"{{days}} días después de recibir este aviso",
} as const;
