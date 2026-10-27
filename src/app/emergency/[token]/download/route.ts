import { downloadEmergencyExport } from "@/domains/vault/emergency";

export const dynamic = "force-dynamic";

/**
 * VAULT-2: the one-time emergency download. The domain checks the link is
 * verified and inside its 24-hour window, builds the export (records pack +
 * the vault decrypted into a PDF), and consumes the link before the bytes
 * are served — a second visit gets a plain "not active" answer.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  try {
    const { fileName, bytes } = await downloadEmergencyExport(token);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "This download link isn't active.";
    return new Response(message, {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }
}
