import { NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";
import { z } from "zod";
import { getServerSession } from "@/lib/session";
import { isNonProductionDeployment } from "@/lib/deployment-safety";
import { canUploadPhoto } from "@/domains/uploads";

// Mints one-time upload tokens for every "add a photo" button in the app
// — appliance-type photos and job condition photos in the desk
// (OWNER/ADMIN), and, as of 2026-09-28, a customer's own photo on a
// maintenance request they're submitting (src/app/account/maintenance).
// The file itself goes straight from the phone/browser to Vercel Blob
// storage — never through this server — this route only decides
// *whether* to hand out a token at all, so a signed-out visitor can't use
// it to fill the Blob store with junk. Tokens are scoped to the caller's
// permitted record namespace; customers use their own maintenance folder,
// staff use existing jobs and OWNER/ADMIN manage inventory/site photos. See
// docs/DECISIONS.md (2026-09-28, "Photo uploads: camera/file picker
// instead of pasting a URL").
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — comfortably covers one phone photo
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

  // Preview currently has no verified independent Blob store. Refuse
  // token minting even if a production Blob credential was inherited.
  if (isNonProductionDeployment()) {
    return NextResponse.json(
      {
        error:
          "Photo uploads are disabled in previews until separate storage is verified.",
      },
      { status: 503 },
    );
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
    if (!(await canUploadPhoto(session.user, body.payload.pathname))) {
      return NextResponse.json(
        { error: "You cannot upload a photo to this record." },
        { status: 403 },
      );
    }
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (pathname !== body.payload.pathname)
          throw new Error("Upload path changed.");
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
