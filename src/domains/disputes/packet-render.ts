// OPS-5: draws the dispute evidence packet as ONE PDF no larger than Stripe accepts. Pure apart from reading photo bytes
// through the loader the caller passes in. Photos are shrunk first; if the PDF is still too large the oldest photos are
// dropped one at a time until it fits. The written facts are never dropped.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import sharp from "sharp";
import { MAX_EVIDENCE_BYTES, whole } from "./rules";

export type PacketPhoto = { id: string; takenAt: Date; label: string };

export type PacketData = {
  dispute: { id: string; stripeDisputeId: string; amountCents: number; reason: string; openedAt: Date; dueBy: Date | null };
  customer: { name: string; email: string | null };
  agreement: null | {
    id: string; startDate: Date | null; termMonths: number | null; depositCents: number;
    lines: { label: string; monthlyPriceCents: number }[];
    signature: null | { provider: string; signedAt: Date | null; signerName: string | null; signerEmail: string | null; ipAddress: string | null };
    signingPayment: null | { signedAt: Date; setupFeeCents: number; downPaymentCents: number; totalCents: number };
    refundTerms: string[];
  };
  deliveries: { id: string; type: string; completedAt: Date | null; outcome: string | null; notes: string | null; photos: PacketPhoto[] }[];
  invoice: null | {
    number: number; issuedAt: Date | null; dueDate: Date | null; periodStart: Date | null; periodEnd: Date | null;
    subtotalCents: number; taxCents: number; lateFeeCents: number; amountDueCents: number; amountPaidCents: number;
    lines: { description: string; amountCents: number; quantity: number }[];
    payments: { at: Date; amountCents: number; method: string | null; status: string }[];
    refunds: { at: Date; amountCents: number; reason: string }[];
  };
  messages: { at: Date; channel: string; purpose: string; state: string; subject: string | null }[];
  businessName: string;
  generatedAt: Date;
};

export type PacketResult = { pdf: Uint8Array; bytes: number; photosIncluded: number; photosDropped: number };
export type PhotoLoader = (photoId: string) => Promise<Buffer | null>;

const PAGE = { w: 612, h: 792, margin: 54 };

/** Standard PDF fonts only draw Western characters; anything else would stop the whole packet, so it becomes "?". */
export function safeText(value: string): string {
  return value.replace(/[\r\t]+/g, " ").replace(/[^\n -~ -ÿ]/g, (c) => {
    if (c === "‘" || c === "’") return "'";
    if (c === "“" || c === "”") return '"';
    if (c === "–" || c === "—") return "-";
    return "?";
  });
}

function day(value: Date | null): string {
  return value ? value.toLocaleDateString("en-US", { timeZone: "America/Denver", year: "numeric", month: "short", day: "numeric" }) : "not recorded";
}
function dayTime(value: Date | null): string {
  return value ? value.toLocaleString("en-US", { timeZone: "America/Denver", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " (Denver time)" : "not recorded";
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of safeText(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else { if (line) lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

async function shrink(bytes: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(bytes, { failOn: "none" }).rotate().resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 65, mozjpeg: true }).toBuffer();
  } catch {
    return null;
  }
}

async function draw(data: PacketData, photos: { photo: PacketPhoto; jpeg: Buffer }[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  const width = PAGE.w - PAGE.margin * 2;
  const room = (need: number) => { if (y - need < PAGE.margin) { page = pdf.addPage([PAGE.w, PAGE.h]); y = PAGE.h - PAGE.margin; } };
  const text = (value: string, opts: { size?: number; bold?: boolean; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.bold ? bold : font;
    for (const line of wrap(value, f, size, width)) {
      room(size + 4);
      page.drawText(line, { x: PAGE.margin, y: y - size, size, font: f, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 3;
    }
    y -= opts.gap ?? 0;
  };
  const heading = (value: string) => { y -= 8; room(30); text(value, { size: 13, bold: true, gap: 3 }); };

  text(`${data.businessName} - evidence for a payment dispute`, { size: 16, bold: true, gap: 4 });
  text(`Dispute ${data.dispute.stripeDisputeId} - ${whole(data.dispute.amountCents)} - reason: ${data.dispute.reason}`);
  text(`Opened ${day(data.dispute.openedAt)}. Response due ${day(data.dispute.dueBy)}. Prepared ${dayTime(data.generatedAt)}.`);
  text(`Customer: ${data.customer.name}${data.customer.email ? ` (${data.customer.email})` : ""}`, { gap: 4 });

  heading("1. The signed rental agreement");
  if (!data.agreement) text("No rental agreement is linked to this payment.");
  else {
    const a = data.agreement;
    text(`Agreement ${a.id}. Starts ${day(a.startDate)}${a.termMonths ? `, ${a.termMonths}-month term` : ", month to month"}. Deposit ${whole(a.depositCents)}.`);
    for (const line of a.lines) text(`  - ${line.label}: ${whole(line.monthlyPriceCents)} per month`);
    if (a.signature) text(`Signed ${dayTime(a.signature.signedAt)} by ${a.signature.signerName ?? "the customer"}${a.signature.signerEmail ? ` (${a.signature.signerEmail})` : ""} through ${a.signature.provider}${a.signature.ipAddress ? `, from address ${a.signature.ipAddress}` : ""}.`);
    else text("No electronic signature record is attached to this agreement.");
    if (a.signingPayment) text(`At signing the customer saw and agreed to a total of ${whole(a.signingPayment.totalCents)} (setup ${whole(a.signingPayment.setupFeeCents)}, down payment ${whole(a.signingPayment.downPaymentCents)}) on ${dayTime(a.signingPayment.signedAt)}.`);
  }

  heading("2. Delivery");
  if (data.deliveries.length === 0) text("No completed delivery is recorded for this agreement.");
  for (const d of data.deliveries) {
    text(`${d.type} visit ${d.id}: completed ${dayTime(d.completedAt)}${d.outcome ? `, outcome ${d.outcome}` : ""}.`);
    if (d.notes) text(`  Notes: ${d.notes}`);
    if (d.photos.length) text(`  ${d.photos.length} photo${d.photos.length === 1 ? "" : "s"} taken at the visit${photos.length ? " are on the pages that follow" : ""}.`);
  }

  heading("3. The bill and the payments");
  if (!data.invoice) text("No bill is linked to this payment.");
  else {
    const i = data.invoice;
    text(`Bill #${i.number}: issued ${day(i.issuedAt)}, due ${day(i.dueDate)}${i.periodStart ? `, for ${day(i.periodStart)} to ${day(i.periodEnd)}` : ""}.`);
    for (const l of i.lines) text(`  - ${l.description}${l.quantity > 1 ? ` x${l.quantity}` : ""}: ${l.amountCents < 0 ? "-" : ""}${whole(l.amountCents)}`);
    text(`Subtotal ${whole(i.subtotalCents)}, tax ${whole(i.taxCents)}, late fee ${whole(i.lateFeeCents)}. Amount due ${whole(i.amountDueCents)}, paid ${whole(i.amountPaidCents)}.`);
    for (const p of i.payments) text(`  Payment ${dayTime(p.at)}: ${whole(p.amountCents)} by ${p.method ?? "unknown method"} (${p.status}).`);
    for (const r of i.refunds) text(`  Refund ${dayTime(r.at)}: ${whole(r.amountCents)} (${r.reason}).`);
  }

  heading("4. Messages sent to the customer");
  if (data.messages.length === 0) text("No messages about this bill are recorded.");
  for (const m of data.messages) text(`  ${dayTime(m.at)} - ${m.channel} ${m.purpose.toLowerCase().replaceAll("_", " ")}${m.subject ? `: ${m.subject}` : ""} (${m.state.toLowerCase()}).`);

  heading("5. Refund and cancellation terms the customer agreed to");
  const terms = data.agreement?.refundTerms ?? [];
  if (terms.length === 0) text("The refund terms in effect are those in the signed rental agreement above.");
  for (const t of terms) text(`  - ${t}`);

  for (const { photo, jpeg } of photos) {
    const image = await pdf.embedJpg(jpeg);
    const scaled = image.scaleToFit(PAGE.w - PAGE.margin * 2, PAGE.h - PAGE.margin * 2 - 30);
    page = pdf.addPage([PAGE.w, PAGE.h]);
    y = PAGE.h - PAGE.margin;
    text(`${photo.label} - taken ${dayTime(photo.takenAt)}`, { size: 10, bold: true });
    page.drawImage(image, { x: PAGE.margin, y: y - scaled.height - 4, width: scaled.width, height: scaled.height });
  }
  return pdf.save();
}

/**
 * Build the packet. Photos are compressed, then the oldest are dropped one at a time until the file fits `maxBytes`.
 */
export async function renderEvidencePacket(data: PacketData, loadPhoto: PhotoLoader, maxBytes = MAX_EVIDENCE_BYTES): Promise<PacketResult> {
  const wanted = data.deliveries.flatMap((d) => d.photos).sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const loaded: { photo: PacketPhoto; jpeg: Buffer }[] = [];
  for (const photo of wanted) {
    const raw = await loadPhoto(photo.id).catch(() => null);
    if (!raw) continue;
    const jpeg = await shrink(raw);
    if (jpeg) loaded.push({ photo, jpeg });
  }
  let keep = loaded;
  let dropped = wanted.length - loaded.length;
  for (;;) {
    const pdf = await draw(data, keep);
    if (pdf.byteLength <= maxBytes || keep.length === 0) {
      if (pdf.byteLength > maxBytes) throw new Error("The written part of the packet is larger than Stripe accepts; shorten the bill or message history first.");
      return { pdf, bytes: pdf.byteLength, photosIncluded: keep.length, photosDropped: dropped };
    }
    keep = keep.slice(1); // the list is oldest first, so the oldest photo goes first
    dropped += 1;
  }
}
