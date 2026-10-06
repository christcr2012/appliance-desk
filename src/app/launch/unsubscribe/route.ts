import { unsubscribeLaunch } from "@/domains/launch";
import { isRateLimited } from "@/lib/rate-limit";

const UNSUBSCRIBE_RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };

const responseHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
function page(message: string, token?: string, status = 200) {
  // Token is rendered only after strict hex validation; no subscriber PII or scripts.
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences — Robinson Appliance Rentals</title><body><main><h1>Email preferences</h1><p>${message}</p>${token ? `<form method="post"><input type="hidden" name="token" value="${token}"><button type="submit">Unsubscribe from marketing emails</button></form>` : ""}<p><a href="/">Return to Robinson Appliance Rentals</a></p></main></body></html>`,
    { status, headers: responseHeaders },
  );
}

// GET never unsubscribes: email security scanners routinely open every link.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[a-f0-9]{64}$/.test(token))
    return page("Please use the unsubscribe link in your email.");
  return page(
    "Stop receiving launch news and marketing emails. No login is needed.",
    token,
  );
}

// Supports both the human form and RFC 8058 mailbox one-click POST.
export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  if (await isRateLimited(`launch-unsubscribe:${ip}`, UNSUBSCRIBE_RATE_LIMIT)) {
    return page("Please wait a little before trying that again.", undefined, 429);
  }
  const urlToken = new URL(request.url).searchParams.get("token");
  const form = await request.formData();
  const token = urlToken || String(form.get("token") || "");
  const changed = await unsubscribeLaunch(token);
  return page(
    changed
      ? "You're unsubscribed from marketing emails. This doesn't affect any rental or service messages."
      : "This link isn't valid. Please use the unsubscribe link in your email or contact us.",
  );
}
