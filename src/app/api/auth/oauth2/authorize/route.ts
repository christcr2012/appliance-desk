import { auth } from "@/lib/auth";
import { getMcpIssuer } from "@/mcp/issuer";
import { oauthBrowserRedirect } from "@/mcp/authorize-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** More-specific route than the generic auth catch-all, only for OAuth authorization. */
export async function GET(request: Request): Promise<Response> {
  const response = await auth.handler(request);
  return oauthBrowserRedirect(request, response, getMcpIssuer());
}
export async function POST(request: Request): Promise<Response> {
  const response = await auth.handler(request);
  return oauthBrowserRedirect(request, response, getMcpIssuer());
}
