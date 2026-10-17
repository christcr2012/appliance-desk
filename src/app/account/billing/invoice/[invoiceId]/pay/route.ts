import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { getPayNowUrl, PayNowError } from "@/domains/portal/pay-now";

/** W-20: POST only (so a link preview never opens Stripe). Sends the signed-in customer to their own invoice's Stripe page. */
export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const back = new URL("/account/billing/invoice/" + encodeURIComponent(invoiceId), request.url);
  const session = await getServerSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  try {
    return NextResponse.redirect(await getPayNowUrl(session.user.id, invoiceId), 303);
  } catch (error) {
    if (!(error instanceof PayNowError)) throw error;
    back.searchParams.set("payError", "1");
    return NextResponse.redirect(back, 303);
  }
}
