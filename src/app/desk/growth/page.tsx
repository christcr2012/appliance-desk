// AR-9: Growth moved to Customers › Insights. This file stays as a
// redirect until AR-10 retires it.
import { redirect } from "next/navigation";

export default function GrowthRedirect() {
  redirect("/desk/customers/insights");
}
