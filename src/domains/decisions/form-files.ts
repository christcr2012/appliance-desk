import { Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { FILL_LINE, type FormBlock } from "./form-content";

/**
 * Writes the questionnaire blocks (form-content.ts) as a Word file (docx 9.9.0) and as a PDF (pdf-lib, Helvetica,
 * US Letter). Both are plain text layouts: no fields, no macros, nothing that runs when opened.
 */

const FONT = "Calibri";

export async function questionnaireDocx(blocks: FormBlock[], title: string): Promise<Buffer> {
  const children: Paragraph[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "title":
        children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: block.text, font: FONT })] }));
        break;
      case "heading":
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: block.text, font: FONT })] }));
        break;
      case "text":
        children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: block.text, font: FONT, size: 22 })] }));
        break;
      case "small":
        children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: block.text, font: FONT, size: 18 })] }));
        break;
      case "box":
        // One run per line, so the box and its label stay together when someone ticks it in Word or Google Docs.
        children.push(new Paragraph({ indent: { left: 360 }, spacing: { after: 80 },
          children: [new TextRun({ text: block.text, font: "Segoe UI Symbol", size: 22 })] }));
        break;
      case "blank":
        children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: FILL_LINE.repeat(3), font: FONT, size: 22 })] }));
        break;
      case "pagebreak":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  }
  const doc = new Document({
    title,
    creator: "Appliance Desk",
    description: "Questions from Decisions & reviews",
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

/** Helvetica (WinAnsi) can't draw ☐ and some other characters: use plain stand-ins the parser also reads. */
export function pdfSafeText(text: string): string {
  return text
    .replaceAll("☐", "[ ]")
    .replaceAll("☒", "[x]")
    .replaceAll("☑", "[x]")
    .replaceAll("→", "->")
    .replaceAll("≤", "<=")
    .replaceAll("≥", ">=")
    .replace(/[^\x20-\x7e\xa0-\xff—–‘’“”•…€™]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    // A word longer than the line (a long link) is cut into pieces that fit.
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function questionnairePdf(blocks: FormBlock[], title: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafeText(title));
  pdf.setCreator("Appliance Desk");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [pageWidth, pageHeight] = [612, 792];
  const margin = 54;
  const width = pageWidth - margin * 2;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };
  const draw = (text: string, font: PDFFont, size: number, indent = 0, after = 4) => {
    for (const line of wrap(pdfSafeText(text), font, size, width - indent)) {
      if (y - size < margin) newPage();
      y -= size + 3;
      page.drawText(line, { x: margin + indent, y, size, font, color: rgb(0.09, 0.15, 0.12) });
    }
    y -= after;
  };
  for (const block of blocks) {
    switch (block.kind) {
      case "title": draw(block.text, bold, 16, 0, 10); break;
      case "heading": draw(block.text, bold, 13, 0, 6); break;
      case "text": draw(block.text, regular, 11); break;
      case "small": draw(block.text, regular, 9); break;
      case "box": draw(block.text, regular, 11, 18); break;
      case "blank": draw(FILL_LINE.repeat(3), regular, 11, 0, 6); break;
      case "pagebreak": newPage(); break;
    }
  }
  return pdf.save();
}
