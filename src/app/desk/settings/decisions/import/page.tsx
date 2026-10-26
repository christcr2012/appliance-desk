import { requireRole } from "@/lib/session";
import { ScreenHeader, Toaster } from "@/components/kit";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import a completed form", robots: { index: false, follow: false } };

// DEC-1b: bring a professional's completed questionnaire back. Owner only. Nothing changes until "Apply".
export default async function ImportDecisionsPage() {
  await requireRole("OWNER");
  return (
    <div className="mx-auto max-w-3xl overflow-x-clip px-1 lg:px-0">
      <Toaster />
      <ScreenHeader title="Import a completed form" back={{ href: "/desk/settings/decisions", label: "Back to Decisions & reviews" }} />
      <ImportForm />
    </div>
  );
}
