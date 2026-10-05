import { verifyPrivacyRequest } from "@/domains/privacy";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("request") ?? "";
  const token = url.searchParams.get("token") ?? "";
  let verified = false;
  try {
    await verifyPrivacyRequest(requestId, token);
    verified = true;
  } catch {
    verified = false;
  }
  return Response.redirect(new URL(`/privacy?verified=${verified ? "yes" : "no"}`, request.url), 303);
}
