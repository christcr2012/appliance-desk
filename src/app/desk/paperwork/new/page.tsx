import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { createPaperworkAction } from "../actions";
import { EMPTY_PAPERWORK, PaperworkForm } from "../paperwork-form";

export const metadata = { title: "Add paperwork" };

export default async function NewPaperworkPage() {
  await requireRole("OWNER");
  return (
    <div>
      <PageHeader title="Add paperwork" description="Anything else you need to keep track of: a permit, a bank loan paper, a contract that renews." />
      <Card>
        <PaperworkForm action={createPaperworkAction} initial={EMPTY_PAPERWORK} submitLabel="Save" />
      </Card>
    </div>
  );
}
