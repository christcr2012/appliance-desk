import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "@/lib/session";
import { SITE_PAGE_PATHS } from "@/domains/site-content/links";
import { getLaunchSettings } from "@/domains/launch";

/**
 * V-C4: the door the Website screen's preview goes through. Only a signed-in owner or admin gets past it; anyone else
 * is told the page does not exist (so a visitor learns nothing about drafts). It checks the page and the version, then
 * sends the browser to the real public page with the select-to-edit switch on. The page itself checks the role again
 * before it will show any draft words.
 */
const CITY_PATH = /^\/rent\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION = /^[A-Za-z0-9_-]{8,64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  const role = session?.user.role;
  if (role !== "OWNER" && role !== "ADMIN") return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const params = request.nextUrl.searchParams;
  const path = params.get("path") ?? "/";
  if (!SITE_PAGE_PATHS.includes(path) && !CITY_PATH.test(path)) return new NextResponse("That page cannot be previewed.", { status: 400, headers: { "Cache-Control": "no-store" } });
  const revision = params.get("revision");
  if (revision && !REVISION.test(revision)) return new NextResponse("That version cannot be previewed.", { status: 400, headers: { "Cache-Control": "no-store" } });
  const at = params.get("previewAt");
  if (at && !INSTANT.test(at)) return new NextResponse("That date cannot be previewed.", { status: 400, headers: { "Cache-Control": "no-store" } });

  // While the website is "preparing to launch", visitors are sent from pricing and city pages to the launch page, so that
  // is what the preview has to show too (the editor says so next to those pages).
  const hidden = path === "/pricing" || path.startsWith("/rent/");
  const shown = hidden && (await getLaunchSettings()).prelaunchMode ? "/launch" : path;
  const target = new URL(shown, request.nextUrl.origin);
  if (revision) target.searchParams.set("revision", revision);
  if (at) target.searchParams.set("previewAt", at);
  target.searchParams.set("select", "1");
  const response = NextResponse.redirect(target, 307);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
