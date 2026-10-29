// AR-9: the Fleet report moved to Equipment › Insights. The page and
// costs params carry over unchanged. This file stays as a redirect until
// AR-10 retires it.
import { redirect } from "next/navigation";

export default async function FleetRedirect({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; costs?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.page) query.set("page", params.page);
  if (params.costs) query.set("costs", params.costs);
  const qs = query.toString();
  redirect(qs ? `/desk/inventory/insights?${qs}` : "/desk/inventory/insights");
}
