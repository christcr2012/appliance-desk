import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { statementArtifact } from "@/domains/documents/artifacts";

function notFound(): Response {
  return new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ month: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session || session.user.role !== "CUSTOMER") return notFound();

  const customer = await prisma.customer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, archivedAt: true },
  });
  if (!customer || customer.archivedAt) return notFound();

  const { month } = await params;
  let artifactId: string;
  try {
    artifactId = await statementArtifact(customer.id, month);
  } catch {
    return notFound();
  }

  return Response.redirect(new URL(`/api/documents/${artifactId}`, request.url), 303);
}
