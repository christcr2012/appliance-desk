import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getComplianceFiling } from "@/domains/compliance/filings";
import { build1099Outputs, payerIdentity, type Prepared1099Row } from "@/domains/compliance/information-returns";
import { dollars } from "@/domains/compliance/iris-csv";
import { fillForm8300 } from "@/domains/compliance/pdf-forms";

/**
 * CMP-3: the filing files for an approved filing — the IRIS portal CSV
 * and recipient Copy B PDFs for 1099s, the filled Form 8300 draft for a
 * cash filing. Amounts always come from the filing's approved prepared
 * data, never recomputed live; full tax IDs are decrypted only while a
 * file is being built for the owner.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const filing = await getComplianceFiling(id);
  if (!filing) return new Response("That filing no longer exists.", { status: 404 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");

  try {
    if (filing.obligationKey === "fed.1099_nec" || filing.obligationKey === "fed.1099_misc") {
      if (!["APPROVED", "SUBMITTED", "ACCEPTED"].includes(filing.state)) {
        return new Response("Approve the filing first — the files are built from the approved numbers.", { status: 409 });
      }
      const form = filing.obligationKey === "fed.1099_nec" ? "NEC" : "MISC";
      const prepared = (filing.preparedData ?? {}) as { year?: number; recipients?: Prepared1099Row[] };
      const year = prepared.year ?? Number(filing.periodKey.replace("1099-", ""));
      const rows = Array.isArray(prepared.recipients) ? prepared.recipients : [];
      const outputs = await build1099Outputs(form, year, rows);
      if (kind === "copy") {
        const supplierId = url.searchParams.get("supplier");
        const copy = outputs.copyPdfs.find((c) => c.supplierId === supplierId);
        if (!copy) return new Response("That recipient copy is not part of this filing.", { status: 404 });
        return new Response(Buffer.from(copy.bytes), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="1099-${form}-${year}-copy-b.pdf"`,
          },
        });
      }
      const batch = Number(url.searchParams.get("batch") ?? "0") || 0;
      const csv = outputs.csvFiles[batch];
      if (csv === undefined) return new Response("That portal file batch does not exist.", { status: 404 });
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="iris-1099-${form.toLowerCase()}-${year}${outputs.csvFiles.length > 1 ? `-part-${batch + 1}` : ""}.csv"`,
        },
      });
    }

    if (filing.obligationKey === "fed.8300" && kind === "form8300") {
      if (!["READY_FOR_REVIEW", "APPROVED", "SUBMITTED", "ACCEPTED"].includes(filing.state)) {
        return new Response("Prepare the filing first — the form is filled from the prepared numbers.", { status: 409 });
      }
      const data = (filing.preparedData ?? {}) as { customerId?: string; totalCashCents?: number; receivedOn?: string };
      const customer = data.customerId
        ? await prisma.customer.findUnique({
            where: { id: data.customerId },
            select: { user: { select: { name: true } }, isBusiness: true, companyName: true },
          })
        : null;
      const { party } = await payerIdentity();
      const fullName = customer?.isBusiness && customer.companyName ? customer.companyName : (customer?.user.name ?? "");
      const parts = fullName.trim().split(/\s+/).filter(Boolean);
      const bytes = await fillForm8300({
        lastName: parts.length > 1 ? parts.slice(1).join(" ") : (parts[0] ?? ""),
        firstName: parts.length > 1 ? (parts[0] ?? "") : "",
        dateReceived: data.receivedOn ?? "",
        totalCashDollars: dollars(data.totalCashCents ?? 0),
        businessName: party.name,
        businessEin: party.tin,
        businessAddress: party.street,
        businessCity: party.city,
        businessState: party.state,
        businessZip: party.zip,
      });
      return new Response(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="form-8300-draft.pdf"',
        },
      });
    }
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "The file could not be built.", { status: 400 });
  }
  return new Response("That file is not available for this filing.", { status: 404 });
}
