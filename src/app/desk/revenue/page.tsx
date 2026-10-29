// AR-9: the Revenue ledger moved to Money › Income details. All query
// params carry over. This file stays as a redirect until AR-10 retires it.
import { redirect } from "next/navigation";

export default async function RevenueRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) for (const v of value) query.append(key, v);
  }
  const qs = query.toString();
  redirect(qs ? `/desk/money/income?${qs}` : "/desk/money/income");
}
