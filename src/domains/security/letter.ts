// OPS-7: the breach notice to affected people, filled in from the incident. Chris signs and sends it himself; the app never mails it.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type BreachLetterFacts = {
  businessName: string;
  businessPhone: string;
  businessAddress: string;
  todayText: string;
  discoveredText: string;
  determinedText: string;
  whatHappened: string;
  /** The kinds of information involved, written by the owner. Required: the letter is never made with a blank for it. */
  informationInvolved: string;
};

const DEFAULT_WHAT = "Some of the personal information we keep about you may have been seen by someone who should not have seen it.";

/** The items Colorado requires: date(s) of the breach, what information, contact for the business, bureau numbers, AG contact, and what to do. */
export function renderBreachLetter(f: BreachLetterFacts): { title: string; body: string } {
  const what = f.whatHappened.trim() || DEFAULT_WHAT;
  const involved = f.informationInvolved.trim();
  if (!involved) throw new Error("Write down what kinds of information were involved before opening the letter.");
  if (!f.businessPhone.trim() || /^\[.*\]$/.test(f.businessPhone.trim())) throw new Error("Add your business phone number in Settings first, so people can reach you.");
  if (!f.businessAddress.trim() || /^\[.*\]$/.test(f.businessAddress.trim())) throw new Error("Add your business mailing address in Settings first.");
  const body = [
    "We are writing to tell you about a security problem that may involve your personal information.",
    `What happened: ${what} We found out on ${f.discoveredText} and confirmed on ${f.determinedText}.`,
    `What information was involved: ${involved}`,
    "What we are doing: we are fixing the cause and checking that it cannot happen again.",
    "What you can do: watch your accounts and statements for anything you do not recognize. You can ask the three national credit bureaus (Equifax, Experian and TransUnion) for your free credit reports and place a fraud alert or credit freeze at no cost. The Federal Trade Commission explains the steps at IdentityTheft.gov.",
    "Colorado Attorney General: you can also contact the Colorado Attorney General's office at coag.gov.",
    `Questions: call us at ${f.businessPhone.trim()} or write to ${f.businessAddress.trim()}.`,
  ].join("\n\n");
  return { title: "Notice of a security problem", body };
}

export async function renderBreachLetterPdf(f: BreachLetterFacts): Promise<Uint8Array> {
  const { title, body } = renderBreachLetter(f);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 740;
  const draw = (text: string, size = 11, useBold = false) => {
    const face = useBold ? bold : font;
    const words = text.replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?").split(/\s+/);
    let line = "";
    const flush = () => {
      if (y < 60) { page = pdf.addPage([612, 792]); y = 740; }
      page.drawText(line, { x: 56, y, size, font: face, color: rgb(0, 0, 0) });
      y -= size + 4;
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (face.widthOfTextAtSize(next, size) > 500) { flush(); line = w; } else line = next;
    }
    if (line) flush();
  };
  draw(f.businessName, 14, true);
  y -= 8;
  draw(f.todayText);
  y -= 10;
  draw(title, 12, true);
  y -= 6;
  for (const paragraph of body.split("\n\n")) { draw(paragraph); y -= 6; }
  return pdf.save();
}
