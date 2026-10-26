// OPS-6: the words of the past-due notices. Always in the business's own name (C.R.S. 5-16-103): never "on behalf of",
// never a collection agency, never a threat. A test checks every template here.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const COLLECTION_BUSINESS_NAME = "Robinson Appliance Rentals";

export type NoticeFacts = {
  customerName: string;
  invoiceNumber: number;
  owedCents: number;
  dueOnText: string; // e.g. "October 3, 2026"
  daysPastDue: number;
  finalDeadlineText?: string | null;
  payHowText?: string;
  businessName?: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const payHow = (f: NoticeFacts) => f.payHowText ?? "You can pay from your account on our website, or reply to this message and we will help.";

export function renderSecondNotice(f: NoticeFacts): { subject: string; body: string } {
  const who = f.businessName ?? COLLECTION_BUSINESS_NAME;
  return {
    subject: `${who}: your payment is past due (bill #${f.invoiceNumber})`,
    body: [
      `Hello ${f.customerName},`,
      `This is ${who}. Bill #${f.invoiceNumber} for ${money(f.owedCents)} was due on ${f.dueOnText} and is now ${f.daysPastDue} days past due.`,
      payHow(f),
      `If something has gone wrong, such as a problem with the appliance or a hard month, please tell us. We would rather work it out with you.`,
      `Thank you,`,
      who,
    ].join("\n\n"),
  };
}

export function renderFinalNotice(f: NoticeFacts): { subject: string; body: string } {
  const who = f.businessName ?? COLLECTION_BUSINESS_NAME;
  return {
    subject: `${who}: final notice about bill #${f.invoiceNumber}`,
    body: [
      `Hello ${f.customerName},`,
      `This is ${who}. Bill #${f.invoiceNumber} for ${money(f.owedCents)} was due on ${f.dueOnText} and is now ${f.daysPastDue} days past due. This is our final notice before we decide what to do next.`,
      payHow(f),
      f.finalDeadlineText
        ? `Please pay or contact us by ${f.finalDeadlineText}. After that we may ask you to return the appliance or ask a court to help us collect what is owed.`
        : `Please pay or contact us soon. If we do not hear from you, we may ask you to return the appliance or ask a court to help us collect what is owed.`,
      `If you cannot pay in full, call or write to us about a payment plan.`,
      `Thank you,`,
      who,
    ].join("\n\n"),
  };
}

/** The final notice as a printable one-page letter (Chris can mail it). */
export async function renderFinalNoticeLetterPdf(f: NoticeFacts & { addressLines?: string[]; todayText: string }): Promise<Uint8Array> {
  const { body } = renderFinalNotice(f);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  let y = 740;
  const draw = (text: string, size = 11, useBold = false) => {
    const f2 = useBold ? bold : font;
    const words = text.replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?").split(/\s+/);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (f2.widthOfTextAtSize(next, size) > 500) { page.drawText(line, { x: 56, y, size, font: f2, color: rgb(0, 0, 0) }); y -= size + 4; line = w; } else line = next;
    }
    if (line) { page.drawText(line, { x: 56, y, size, font: f2, color: rgb(0, 0, 0) }); y -= size + 4; }
  };
  draw(f.businessName ?? COLLECTION_BUSINESS_NAME, 14, true);
  y -= 8;
  draw(f.todayText);
  for (const line of f.addressLines ?? []) draw(line);
  y -= 10;
  draw(`Final notice about bill #${f.invoiceNumber}`, 12, true);
  y -= 6;
  for (const paragraph of body.split("\n\n")) { draw(paragraph); y -= 6; }
  return pdf.save();
}
