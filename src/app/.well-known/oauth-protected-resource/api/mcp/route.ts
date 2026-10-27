import { oauthProviderResourceClient } from "@better-auth/oauth-provider/client-resource";
import { getMcpIssuer } from "@/mcp/issuer";

export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const issuer = getMcpIssuer();
  if (!issuer) return new Response(null, { status: 404 });
  const metadata = await oauthProviderResourceClient().getActions().getProtectedResourceMetadata({
    resource: `${issuer}/api/mcp`,
    authorization_servers: [`${issuer}/api/auth`],
  });
  return Response.json(metadata, { headers: { "Cache-Control": "public, max-age=3600" } });
}
