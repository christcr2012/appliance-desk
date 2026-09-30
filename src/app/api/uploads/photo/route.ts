import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getServerSession } from "@/lib/session";
import { isNonProductionDeployment } from "@/lib/deployment-safety";

// Mints one-time upload tokens for every "add a photo" button in the app
// — appliance-type photos and job condition photos in the desk
// (OWNER/ADMIN), and, as of 2026-09-28, a customer's own photo on a
// maintenance request they're submitting (src/app/account/maintenance).
// The file itself goes straight from the phone/browser to Vercel Blob
// storage — never through this server — this route only decides
// *whether* to hand out a token at all, so a signed-out visitor can't use
// it to fill the Blob store with junk. Any signed-in role is allowed
// (not just staff), since a customer needs this too; see
// docs/DECISIONS.md (2026-09-28, "Photo uploads: camera/file picker
// instead of pasting a URL").
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — comfortably covers one phone photo

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Preview currently has no verified independent Blob store. Refuse
  // token minting even if a production Blob credential was inherited.
  if (isNonProductionDeployment()) {
    return NextResponse.json({ error: "Photo uploads are disabled in previews until separate storage is verified." }, { status: 503 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
