import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Purchase orders" };

/**
 * AR-6b section 5: the orders list lives on the Purchases page now
 * (/desk/purchases?view=orders). This URL redirects there; the order
 * record and new-order pages keep their URLs under /desk/purchase-orders.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { open } = await searchParams;
  if (open) redirect(`/desk/purchase-orders/${encodeURIComponent(open)}`);
  redirect("/desk/purchases?view=orders");
}
