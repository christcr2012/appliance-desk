import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest } from "@/domains/agent-control/authorization";
import { buildMcpServer } from "@/mcp/server";
import { mcpPostBodyTooLarge } from "@/mcp/request-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  if (await mcpPostBodyTooLarge(request)) return new Response("Request too large.", { status: 413 });
  const context = await authenticateMcpRequest(request);
  if (context instanceof Response) return context;
  const server = buildMcpServer(context);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request, {
    authInfo: { token: "", clientId: context.connectionId, scopes: context.scopes },
  });
}
export { handle as GET, handle as POST, handle as DELETE };
export function OPTIONS(): Response { return new Response(null, { status: 204, headers: { Allow: "GET, POST, DELETE, OPTIONS" } }); }
