import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth";
import { getMcpIssuer } from "@/mcp/issuer";

export const dynamic = "force-dynamic";
const respond = oauthProviderAuthServerMetadata(auth);
export async function GET(request: Request): Promise<Response> {
  if (!getMcpIssuer()) return new Response(null, { status: 404 });
  return respond(request);
}
