import { NextResponse } from "next/server";
import { uploadWebsiteAsset, draftAssetPath } from "@/domains/site-content/assets";
import { StorageUnavailableError, STORAGE_UNAVAILABLE_MESSAGE } from "@/domains/site-content/asset-store";
import { MAX_UPLOAD_BYTES } from "@/domains/site-content/image-processing";
import { SiteContentError } from "@/domains/site-content/types";
import { getServerSession } from "@/lib/session";

/** Owner/admin picture upload (multipart field "file"). The picture is re-made on the server; nothing is public yet. */
export async function POST(request: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session || (session.user.role !== "OWNER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "That picture is larger than 10 MB. Please choose a smaller one." }, { status: 413 });
  }
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "That upload could not be read." }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a picture to upload." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That picture is larger than 10 MB. Please choose a smaller one." }, { status: 413 });
  }
  try {
    const asset = await uploadWebsiteAsset(session.user.id, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ asset: { ...asset, previewPath: draftAssetPath(asset.id) } }, { status: 201 });
  } catch (error) {
    if (error instanceof StorageUnavailableError) return NextResponse.json({ error: STORAGE_UNAVAILABLE_MESSAGE }, { status: 503 });
    if (error instanceof SiteContentError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && /no longer has access|not allowed/i.test(error.message)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    return NextResponse.json({ error: "The picture could not be saved." }, { status: 500 });
  }
}
