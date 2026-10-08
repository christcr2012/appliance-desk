import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { getPrivatePhotoStore, privatePhotoPathFromUrl } from "@/lib/photo-storage";

function expectedPrivateHost(storeId: string): string {
  return `${storeId.slice("store_".length).toLowerCase()}.private.blob.vercel-storage.com`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session || (session.user as { archivedAt?: unknown }).archivedAt) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const photo = await prisma.photo.findUnique({
    where: { id },
    select: {
      id: true,
      url: true,
      jobId: true,
      applianceId: true,
      maintenanceRequestId: true,
      maintenanceRequest: {
        select: { customer: { select: { userId: true } } },
      },
    },
  });

  if (!photo) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }

  const role = session.user.role;
  const teamRole = role === "OWNER" || role === "ADMIN" || role === "STAFF";
  const customerOwnsMaintenancePhoto =
    role === "CUSTOMER" &&
    photo.maintenanceRequestId !== null &&
    photo.jobId === null &&
    photo.applianceId === null &&
    photo.maintenanceRequest?.customer.userId === session.user.id;

  if (!teamRole && !customerOwnsMaintenancePhoto) {
    // Hide whether the requested photo id exists outside the caller's scope.
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }

  const store = getPrivatePhotoStore();
  if (!store) {
    return NextResponse.json(
      { error: "Private photo storage is not configured for this environment." },
      { status: 503 },
    );
  }

  // Tax-filing confirmations are finance evidence, unlike ordinary job
  // photos. A STAFF user who learns the Photo id cannot read the blob.
  const privatePath = privatePhotoPathFromUrl(photo.url, store.storeId);
  const taxFilingPhoto = privatePath?.startsWith("tax-filings/") ||
    (await prisma.taxFilingPeriod.findFirst({
      where: { confirmationPhotoId: photo.id }, select: { id: true },
    })) !== null;
  if (taxFilingPhoto && role !== "OWNER" && role !== "ADMIN") {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }

  let url: URL;
  try {
    url = new URL(photo.url);
  } catch {
    return NextResponse.json({ error: "Photo storage reference is invalid." }, { status: 502 });
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== expectedPrivateHost(store.storeId) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return NextResponse.json({ error: "Photo storage reference is invalid." }, { status: 502 });
  }

  try {
    const result = await get(photo.url, {
      token: store.token,
      access: "private",
      useCache: true,
      abortSignal: AbortSignal.timeout(15_000),
    });
    if (!result || result.statusCode !== 200) {
      return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    }

    return new Response(result.stream, {
      status: 200,
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        "Content-Length": String(result.blob.size),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Photo could not be loaded." }, { status: 502 });
  }
}
