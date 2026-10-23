import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getPaperwork } from "@/domains/paperwork";
import { businessDateKey } from "@/lib/business-date";
import { Button, Card, PageHeader } from "@/components/ui";
import { deletePaperworkAction, markPaperworkDoneAction, updatePaperworkAction } from "../actions";
import { PaperworkForm } from "../paperwork-form";

export const metadata = { title: "Paperwork item" };
export const dynamic = "force-dynamic";

export default async function PaperworkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("OWNER");
  const { id } = await params;
  const item = await getPaperwork(session.user.role, id);
  if (!item) notFound();

  const repeats = item.repeatEveryMonths !== null;
  return (
    <div className="space-y-6">
      <PageHeader
        title={item.title}
        description={item.whatItIs ?? undefined}
        secondaryActions={<Link href="/desk/paperwork" className="text-sm font-semibold text-action underline">Back to all paperwork</Link>}
      />
      {item.officialUrl && (
        <p className="text-sm">
          <a href={item.officialUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-action underline">
            Open the official website{item.agency ? ` (${item.agency})` : ""}
          </a>
        </p>
      )}
      <Card
        title="Done with it?"
        description={
          repeats
            ? "Press this when you've renewed or filed it. The date moves to the next one automatically."
            : "Press this when it's finished. It stops reminding you."
        }
      >
        <form action={markPaperworkDoneAction.bind(null, item.id, item.version)}>
          <Button type="submit" variant="secondary">
            {repeats ? "Mark done and schedule the next one" : "Mark done"}
          </Button>
        </form>
      </Card>
      <Card title="Details">
        <PaperworkForm
          action={updatePaperworkAction.bind(null, item.id, item.version)}
          submitLabel="Save changes"
          initial={{
            title: item.title,
            groupName: item.groupName,
            status: item.status,
            whatItIs: item.whatItIs ?? "",
            agency: item.agency ?? "",
            officialUrl: item.officialUrl ?? "",
            referenceNumber: item.referenceNumber ?? "",
            startedOn: item.startedOn ? businessDateKey(item.startedOn) : "",
            dueOn: item.dueOn ? businessDateKey(item.dueOn) : "",
            remindDaysBefore: item.remindDaysBefore,
            repeatEveryMonths: item.repeatEveryMonths ? String(item.repeatEveryMonths) : "",
            notes: item.notes ?? "",
          }}
        />
      </Card>
      {!item.templateKey && (
        <Card title="Remove this item">
          <p className="mb-3 text-sm text-ink-soft">This deletes only your own reminder. Nothing else in the app is affected.</p>
          <form action={deletePaperworkAction.bind(null, item.id)}>
            <Button type="submit" variant="danger">Delete this item</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
