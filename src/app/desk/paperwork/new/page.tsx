import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { OBLIGATIONS } from "@/domains/compliance/registry";
import { createPaperworkAction } from "../actions";
import { EMPTY_PAPERWORK, PaperworkForm } from "../paperwork-form";

export const metadata = { title: "Add a record" };

export default async function NewPaperworkPage() {
  await requireRole("OWNER");
  return (
    <div>
      <PageHeader title="Add a record" description="Anything else you need to keep track of: a permit, a bank account, a contract that renews, a document to keep." />
      <Card>
        <PaperworkForm
          action={createPaperworkAction}
          initial={EMPTY_PAPERWORK}
          submitLabel="Save"
          obligationOptions={OBLIGATIONS.map((o) => ({ key: o.key, title: o.title }))}
        />
      </Card>
    </div>
  );
}
