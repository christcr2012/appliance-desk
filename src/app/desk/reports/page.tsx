// AR-9: Reports moved to the Money Overview (the CSV export route at
// /desk/reports/export stays). This file stays as a redirect until AR-10
// retires it.
import { redirect } from "next/navigation";

export default function ReportsRedirect() {
  redirect("/desk/money");
}
