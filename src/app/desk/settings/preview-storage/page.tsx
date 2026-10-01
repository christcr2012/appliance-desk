import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { previewStorageConfigured } from "@/domains/preview-storage";
import { PageHeader, SectionCard } from "@/components/desk/workspace";
import { PreviewStorageCheckForm } from "./check-form";

export const metadata = { title: "Preview storage check", robots: { index: false, follow: false } };

export default async function PreviewStoragePage() {
  await requireRole("OWNER");
  if (!previewStorageConfigured()) notFound();
  return (
    <>
      <PageHeader title="Preview storage check" description="Verify isolated test storage before roadmap changes." />
      <SectionCard title="Private test files">
        <PreviewStorageCheckForm />
      </SectionCard>
    </>
  );
}
