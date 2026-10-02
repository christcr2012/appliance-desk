import { NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";
import { z } from "zod";
import { getServerSession } from "@/lib/session";
import { isNonProductionDeployment } from "@/lib/deployment-safety";
import { canUploadPhoto } from "@/domains/uploads";
import {
  getPrivatePhotoStore,
  getPublicPhotoWriteToken,
  isPrivatePhotoPath,
  isPublicPhotoPath,
} from "@/lib/photo-storage";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const uploadBody = z.object({
  type: z.literal("blob.generate-client-token"),
  payload: z.object({
    pathname: z.string().min(1).max(1024),
    multipart: z.boolean(),
    clientPayload: z.string().max(1024).nullable(),
  }),
});

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session || (session.user as { archivedAt?: unknown }).archivedAt) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const parsed = uploadBody.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid photo upload request." },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const pathname = body.payload.pathname;
    const isPublic = isPublicPhotoPath(pathname);
    const isPrivate = isPrivatePhotoPath(pathname);
    if (!isPublic && !isPrivate) {
      return NextResponse.json(
        { error: "Invalid photo storage namespace." },
        { status: 400 },
      );
    }

    if (!(await canUploadPhoto(session.user, pathname))) {
      return NextResponse.json(
        { error: "You cannot upload a photo to this record." },
        { status: 403 },
      );
    }

    let token: string | null;
    if (isPublic) {
      // The production catalog-photo store is deliberately connected only to
      // Production. Never let a preview inherit/use that credential.
      if (isNonProductionDeployment()) {
        return NextResponse.json(
          {
            error:
              "Public catalog photo uploads are disabled outside production.",
          },
          { status: 503 },
        );
      }
      token = getPublicPhotoWriteToken();
    } else {
      // Operational/customer evidence must never fall back to the public Blob
      // credential. Preview uses its already-verified independent private
      // store; production requires an explicitly configured private store.
      token = getPrivatePhotoStore()?.token ?? null;
    }

    if (!token) {
      return NextResponse.json(
        {
          error: isPrivate
            ? "Private photo storage is not configured for this environment."
            : "Photo storage is not configured for this environment.",
        },
        { status: 503 },
      );
    }

    const jsonResponse = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (requestedPathname) => {
        if (requestedPathname !== pathname) {
          throw new Error("Upload path changed.");
        }
        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
          ],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof SyntaxError
            ? "Invalid photo upload request."
            : "Photo upload failed. Please try again.",
      },
      { status: 400 },
    );
  }
}
