// OPS-2: the signed statement handed to the scrap yard. Built from the saved record, so reprinting always matches what was signed.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { OUTCOME_LABELS, type RefrigerantOutcomeName } from "./rules";

export type StatementFacts = {
  businessName: string;
  assetNumber: string;
  applianceDescription: string;
  serialNumber: string | null;
  refrigerantType: string;
  outcome: RefrigerantOutcomeName;
  recoveredByName: string;
  recoveredByAddress: string;
  certificationNumber: string | null;
  equipmentUsed: string | null;
  recoveredOnText: string;
  signedByName: string;
  signedOnText: string;
};

export function statementLines(f: StatementFacts): string[] {
  const lines = [
    `Appliance: ${f.applianceDescription} (our asset ${f.assetNumber}${f.serialNumber ? `, serial ${f.serialNumber}` : ""})`,
    `Refrigerant type: ${f.refrigerantType}`,
    f.outcome === "RECOVERED"
      ? `The refrigerant was removed from this appliance before disposal with refrigerant recovery equipment${f.equipmentUsed ? ` (${f.equipmentUsed})` : ""}.`
      : "The refrigerant had already leaked out of this appliance before we received it. No lines were cut to release refrigerant.",
    f.outcome === "RECOVERED"
      ? `Recovered by: ${f.recoveredByName}, ${f.recoveredByAddress}${f.certificationNumber ? `, technician certification ${f.certificationNumber}` : ""}`
      : `Statement made by: ${f.recoveredByName}${f.recoveredByAddress && f.recoveredByAddress !== "—" ? `, ${f.recoveredByAddress}` : ""}`,
    `Date: ${f.recoveredOnText}`,
    `Signed on screen by ${f.signedByName} for ${f.businessName} on ${f.signedOnText}.`,
  ];
  return lines;
}

export async function renderStatementPdf(f: StatementFacts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  let y = 730;
  const draw = (text: string, size = 11, useBold = false) => {
    const face = useBold ? bold : font;
    const words = text.replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?").split(/\s+/);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (face.widthOfTextAtSize(next, size) > 500) { page.drawText(line, { x: 56, y, size, font: face, color: rgb(0, 0, 0) }); y -= size + 4; line = w; } else line = next;
    }
    if (line) { page.drawText(line, { x: 56, y, size, font: face, color: rgb(0, 0, 0) }); y -= size + 4; }
  };
  draw(f.businessName, 14, true);
  y -= 6;
  draw("Refrigerant removal statement", 13, true);
  y -= 10;
  for (const line of statementLines(f)) { draw(line); y -= 8; }
  y -= 12;
  draw(OUTCOME_LABELS[f.outcome], 9);
  return pdf.save();
}
