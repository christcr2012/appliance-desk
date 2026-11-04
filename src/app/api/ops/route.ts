import { type NextRequest, NextResponse } from "next/server";
import { opsDiscoveryDocument } from "@/domains/system-issues/ops-contract";

export const dynamic = "force-dynamic";

/**
 * Keyless discovery document for the AI check-up API. Public on purpose:
 * it serves only the static contract from ops-contract.ts — no database
 * access, no issue data, no key material — so an assistant handed a key
 * can re-learn how to use it at any time. It answers identically whether
 * or not a key is sent; the key stays the only credential and is never
 * read or echoed here.
 */
export async function GET(request: NextRequest) {
  const document = opsDiscoveryDocument(new URL(request.url).origin);
  return NextResponse.json(document, { headers: { "Cache-Control": "no-store" } });
}
