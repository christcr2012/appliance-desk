import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { previewStorageConfigured } from "@/domains/preview-storage";
import { SectionCard } from "@/components/desk/workspace";
import { ScreenHeader } from "@/components/kit";
import { PreviewStorageCheckForm } from "./check-form";

export const metadata = { title: "Preview storage check", robots: { index: false, follow: false } };

export default async function PreviewStoragePage() {
  await requireRole("OWNER");
  if (!previewStorageConfigured()) notFound();
  return (
    <>
      <ScreenHeader title="Preview storage check" />
      <p className="-mt-2 text-sm text-ink-soft">Verify isolated test storage before roadmap changes.</p>
      <SectionCard title="Private test files">
        <PreviewStorageCheckForm />
      </SectionCard>
    </>
  );
}
