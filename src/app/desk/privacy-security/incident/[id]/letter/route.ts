import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { renderBreachLetterPdf } from "@/domains/security/letter";

const dateText = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "long", day: "numeric", year: "numeric" }).format(d);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  await requireRole("OWNER");
  const { id } = await params;
  const incident = await prisma.securityIncident.findUnique({ where: { id } });
  if (!incident || !incident.determinedAt) return NextResponse.json({ error: "Record the decision first." }, { status: 404 });
  const [launch, settings] = await Promise.all([
    prisma.launchSettings.findUnique({ where: { id: "singleton" }, select: { postalAddress: true } }),
    prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { publicPhone: true, publicAddress: true, publicBusinessName: true } }),
  ]);
  const address = launch?.postalAddress?.trim() || settings?.publicAddress || "";
  let pdf: Uint8Array;
  try {
    pdf = await renderBreachLetterPdf({
    businessName: "Robinson Appliance Rentals",
    businessPhone: settings?.publicPhone ?? "",
    businessAddress: address,
    informationInvolved: incident.informationInvolved ?? "",
    todayText: dateText(new Date()),
    discoveredText: dateText(incident.discoveredAt),
    determinedText: dateText(incident.determinedAt),
    whatHappened: incident.summary,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The letter could not be made." }, { status: 409 });
  }
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="security-notice.pdf"`, "cache-control": "private, no-store" } });
}
