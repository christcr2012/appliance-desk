// AR-9: Reports moved to the Money Overview for the owner and admins (the
// CSV export route at /desk/reports/export stays). The accountant's
// profile link pointed here and Reports admitted ACCOUNTANT, so the
// accountant goes to the Books reports they are allowed to open instead
// of the owner-only Money overview.
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";

export default async function ReportsRedirect() {
  const session = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  redirect(session.user.role === "ACCOUNTANT" ? "/desk/books/reports" : "/desk/money");
}
