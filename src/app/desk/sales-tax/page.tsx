import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
export default async function SalesTaxRootPage() {
  await requireRole("OWNER", "ADMIN");
  redirect("/desk/sales-tax/setup");
}
