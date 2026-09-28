import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getServerSession } from "@/lib/session";
import type { Role } from "@/lib/session";

// Mints one-time upload tokens for the "add a photo" buttons in the desk
// (appliance-type photos in Settings, condition photos on a job). The file
// itself goes straight from the phone/browser to Vercel Blob storage —
// never through this server — this route only decides *whether* to hand
// out a token, so a signed-out visitor can't use it to fill the Blob
// store with junk. See docs/DECISIONS.md (2026-09-28, "Photo uploads:
// camera/file picker instead of pasting a URL").
const STAFF_ROLES: Role[] = ["OWNER", "ADMIN"];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — comfortably covers one phone photo

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession();
  const role = (session?.user as { role?: Role } | undefined)?.role;
  if (!session || !role || !STAFF_ROLES.includes(role)) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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
