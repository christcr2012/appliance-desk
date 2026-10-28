import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import {
  auditRecordDownload,
  contentDisposition,
  getRecord,
  getRecordFileRow,
  readRecordFileBytes,
} from "@/domains/paperwork/records";

/**
 * VAULT-1: read one business-record file. The record gate decides: OWNER sees
 * everything; ADMIN only records the owner's setting allows (and never a
 * number-bearing record's files); anyone else — and any file on a record the
 * caller may not see — reads as "not found", so file ids leak nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session || (session.user as { archivedAt?: unknown }).archivedAt) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "ACCOUNTANT") {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  const { id } = await params;
  const file = await getRecordFileRow(id);
  if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });
  const record = await getRecord(role, file.recordId);
  if (!record) return NextResponse.json({ error: "File not found." }, { status: 404 });

  const result = await readRecordFileBytes(file);
  if (!result) return NextResponse.json({ error: "File not found." }, { status: 404 });

  if (role === "OWNER" || role === "ACCOUNTANT") {
    await auditRecordDownload(session.user.id, file.recordId, file.id);
  }
  return new Response(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(result.bytes.length),
      "Content-Disposition": contentDisposition(file.fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
