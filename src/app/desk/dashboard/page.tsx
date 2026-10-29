// AR-9: the Dashboard moved to Today. This file stays as a redirect until
// AR-10 retires it.
import { redirect } from "next/navigation";

export default function DashboardRedirect() {
  redirect("/desk/today");
}
