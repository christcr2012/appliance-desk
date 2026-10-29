import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card } from "@/components/ui";
import { OBLIGATIONS } from "@/domains/compliance/registry";
import { createPaperworkAction } from "../actions";
import { EMPTY_PAPERWORK, PaperworkForm } from "../paperwork-form";

export const metadata = { title: "Add a record" };

export default async function NewPaperworkPage() {
  await requireRole("OWNER");
  return (
    <div>
      <Link href="/desk/paperwork" className="text-sm text-ink-soft hover:underline">
        &larr; Back to paperwork
      </Link>

      <h1 className="mt-2 text-xl font-semibold">Add a record</h1>
      <p className="mt-1 text-sm text-ink-soft">Anything else you need to keep track of: a permit, a bank account, a contract that renews, a document to keep.</p>
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
