import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { freezeInvoiceArtifact } from "@/domains/documents/artifacts";

function notFound(): Response {
  return new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session || session.user.role === "STAFF") return notFound();

  const { invoiceId } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { customerId: true },
  });
  if (!invoice) return notFound();

  if (session.user.role === "CUSTOMER") {
    const customer = await prisma.customer.findUnique({
      where: { userId: session.user.id },
      select: { id: true, archivedAt: true },
    });
    if (!customer || customer.archivedAt || customer.id !== invoice.customerId) return notFound();
  } else if (session.user.role !== "OWNER" && session.user.role !== "ADMIN") {
    return notFound();
  }

  const artifactId = await freezeInvoiceArtifact(invoiceId);
  if (!artifactId) return notFound();

  return Response.redirect(new URL(`/api/documents/${artifactId}`, request.url), 303);
}
