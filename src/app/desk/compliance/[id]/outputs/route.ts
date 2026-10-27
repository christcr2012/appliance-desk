import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getComplianceFiling } from "@/domains/compliance/filings";
import { build1099Outputs, payerIdentity, type Prepared1099Row } from "@/domains/compliance/information-returns";
import { dollars } from "@/domains/compliance/iris-csv";
import { fillDr0104EpVoucher, fillDs056, fillDs060, fillEstimatedTaxVoucher, fillForm8300, VOUCHER_BOOKLET_YEAR } from "@/domains/compliance/pdf-forms";
import { bppBusinessFromPrepared, bppSnapshotFromPrepared, bppSpreadsheetCsv } from "@/domains/compliance/bpp";
import { packetCsv, packetPdf, type PacketData } from "@/domains/compliance/schedule-c";
import type { QuarterlyEstimate } from "@/domains/compliance/estimates";

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

    if (filing.obligationKey === "fed.income.schedule_c" && (kind === "packet-csv" || kind === "packet-pdf")) {
      if (!["APPROVED", "SUBMITTED", "ACCEPTED"].includes(filing.state)) {
        return new Response("Approve the filing first — the packet is built from the approved numbers.", { status: 409 });
      }
      const packet = (filing.preparedData ?? null) as PacketData | null;
      if (!packet || !packet.scheduleC) return new Response("That packet is not part of this filing.", { status: 404 });
      if (kind === "packet-csv") {
        return new Response(packetCsv(packet), {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="accountant-packet-${packet.year}.csv"`,
          },
        });
      }
      const bytes = await packetPdf(packet);
      return new Response(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="accountant-packet-${packet.year}.pdf"`,
        },
      });
    }

    if (filing.obligationKey === "co.bpp.weld_declaration" && ["bpp-csv", "ds056", "ds060"].includes(kind ?? "")) {
      if (!["APPROVED", "SUBMITTED", "ACCEPTED"].includes(filing.state)) {
        return new Response("Approve the filing first — the files are built from the approved snapshot.", { status: 409 });
      }
      const snapshot = bppSnapshotFromPrepared(filing.preparedData);
      if (!snapshot) return new Response("That snapshot is not part of this filing.", { status: 404 });
      if (kind === "bpp-csv") {
        return new Response(bppSpreadsheetCsv(snapshot), {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="weld-declaration-${snapshot.year}.csv"`,
          },
        });
      }
      const business = bppBusinessFromPrepared(filing.preparedData);
      const cityLine =
        [business?.city, business?.state].filter(Boolean).join(", ") + (business?.zip ? ` ${business.zip}` : "");
      const identity = {
        mailing: [business?.legalName ?? undefined, business?.address ?? undefined, cityLine || undefined]
          .filter(Boolean)
          .join("\n"),
        propertyLocation: [business?.legalName ?? undefined, "Greeley, CO"].filter(Boolean).join(" — "),
        productOrService: "Appliance rental",
        county: "Weld",
        ownerName: business?.legalName ?? undefined,
        phone: business?.phone ?? undefined,
      };
      const describe = (item: (typeof snapshot.items)[number]) =>
        item.serialNumber ? `${item.description} — serial ${item.serialNumber}` : item.description;
      if (kind === "ds056") {
        const bytes = await fillDs056({
          identity,
          newBusiness: snapshot.firstTimeFiler,
          rows: snapshot.items.slice(0, 5).map((item) => ({
            itemId: item.assetNumber,
            quantity: "1",
            description: describe(item),
            yearAcquired: String(item.yearAcquired),
            originalCost: dollars(item.costCents),
            placedInService: item.placedInService,
          })),
        });
        return new Response(Buffer.from(bytes), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="ds-056-weld-${snapshot.year}.pdf"`,
          },
        });
      }
      const rented = snapshot.items.filter((item) => item.rentedOut);
      const renters = new Set(rented.map((item) => item.userName).filter(Boolean));
      const firstRented = rented[0];
      const bytes = await fillDs060({
        identity,
        singleRenter:
          renters.size === 1 && firstRented?.userName
            ? `${firstRented.userName}\n${firstRented.userAddress ?? ""}`
            : undefined,
        rows: rented.slice(0, 4).map((item) => ({
          quantity: "1",
          description: describe(item),
          leaseTerm: "",
          monthlyRent: item.monthlyRentCents !== null ? dollars(item.monthlyRentCents) : "",
          yearAcquired: String(item.yearAcquired),
          originalCost: dollars(item.costCents),
          placedInService: item.placedInService,
        })),
      });
      return new Response(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="ds-060-weld-${snapshot.year}.pdf"`,
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

/**
 * CMP-2: the filled estimated-tax voucher. The owner's name and Social
 * Security number arrive with this request only and are used to fill
 * the PDF — they are never stored, logged or audited. The amount comes
 * from the filing's prepared numbers, never from the form.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const filing = await getComplianceFiling(id);
  if (!filing) return new Response("That filing no longer exists.", { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.get("kind") !== "voucher") {
    return new Response("That file is not available for this filing.", { status: 404 });
  }
  if (filing.obligationKey !== "fed.estimated_tax" && filing.obligationKey !== "co.income.dr0104ep") {
    return new Response("That file is not available for this filing.", { status: 404 });
  }
  if (!["READY_FOR_REVIEW", "APPROVED", "SUBMITTED", "ACCEPTED"].includes(filing.state)) {
    return new Response("Prepare the filing first — the voucher is filled from the prepared amount.", { status: 409 });
  }
  const estimate = (filing.preparedData ?? null) as QuarterlyEstimate | null;
  if (!estimate || estimate.status !== "OK") {
    return new Response("There is no worked-out amount to put on a voucher for this filing.", { status: 409 });
  }
  if (estimate.year !== VOUCHER_BOOKLET_YEAR) {
    return new Response(
      `A filled voucher is only available for ${VOUCHER_BOOKLET_YEAR} — the official booklet on file is that year's. For ${estimate.year}, pay online or use that year's paper voucher.`,
      { status: 400 },
    );
  }
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const ssn = field("ssn").replace(/[^0-9]/g, "");
  if (ssn.length !== 9) return new Response("Enter the 9-digit Social Security number for the voucher.", { status: 400 });
  const values = {
    firstName: field("firstName"),
    lastName: field("lastName"),
    middleInitial: field("middleInitial"),
    ssn,
    address: field("address"),
    city: field("city"),
    state: field("state"),
    zip: field("zip"),
    amountDollars: dollars(estimate.quarterCents),
  };
  if (!values.firstName || !values.lastName) {
    return new Response("Enter the name for the voucher.", { status: 400 });
  }
  try {
    const bytes =
      filing.obligationKey === "fed.estimated_tax"
        ? await fillEstimatedTaxVoucher(estimate.quarter as 1 | 2 | 3 | 4, values)
        : await fillDr0104EpVoucher(values);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="estimated-tax-voucher-q${estimate.quarter}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "The voucher could not be built.", { status: 400 });
  }
}
