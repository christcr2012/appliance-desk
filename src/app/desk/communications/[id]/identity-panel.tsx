"use client";

// AR-4d (QUOTES-MESSAGES spec section 3): the thread page's "Who is this?"
// sheet. Unknown and shared numbers get linked to a person here; linking
// ends the number's other matches, so when there are any, a confirmation
// names them first. A resolved thread can be unlinked ("This isn't them").

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ConfirmDialog,
  SearchablePicker,
  Sheet,
  actionButtonClass,
} from "@/components/kit";

function Btn({
  label,
  primary,
  ...props
}: {
  label: string;
  primary?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={actionButtonClass({
        spec: { kind: "link", label, href: "#", primary },
        variant: primary ? "primary" : "secondary",
      })}
    >
      {label}
    </button>
  );
}
import {
  linkThreadIdentityAction,
  searchPeopleAction,
  unlinkThreadIdentityAction,
} from "./actions";

type OtherMatch = { kind: "customer" | "lead"; id: string; name: string };

export function IdentityPanel({
  threadId,
  version,
  resolution,
  currentName,
  otherMatches,
}: {
  threadId: string;
  version: number;
  resolution: string;
  currentName: string | null;
  otherMatches: OtherMatch[];
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<{ picked: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTransition, startTransition] = useTransition();
  const labels = useRef(new Map<string, string>());

  const search = async (q: string) => {
    const rows = await searchPeopleAction(q);
    for (const r of rows) labels.current.set(r.id, r.label);
    return rows;
  };

  const doLink = (picked: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await linkThreadIdentityAction(threadId, picked, version);
        setConfirmOpen(false);
        setSheetOpen(false);
        router.refresh();
      } catch (e) {
        setConfirmOpen(false);
        setError(e instanceof Error ? e.message : "Couldn't link this number.");
      }
    });
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const picked = String(new FormData(event.currentTarget).get("person") ?? "");
    if (!picked) {
      setError("Choose a person first.");
      return;
    }
    const label = labels.current.get(picked) ?? "this person";
    if (otherMatches.length > 0) {
      setPending({ picked, label });
      setConfirmOpen(true);
    } else {
      doLink(picked);
    }
  };

  const onUnlink = () => {
    setError(null);
    startTransition(async () => {
      try {
        await unlinkThreadIdentityAction(threadId);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't unlink this number.");
      }
    });
  };

  if (resolution === "RESOLVED" && currentName) {
    return (
      <div className="mt-4 border-t border-line pt-4">
        <p className="text-sm">
          This number is linked to <strong>{currentName}</strong>.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">{error}</p>
        ) : null}
        <div className="mt-2">
          <Btn label="This isn't them" type="button" onClick={onUnlink} disabled={pendingTransition} />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm">
        We don&apos;t know whose number this is yet
        {resolution === "AMBIGUOUS" ? " — it matches more than one person" : ""}.
      </p>
      {error && !sheetOpen ? (
        <p role="alert" className="mt-2 text-sm text-danger">{error}</p>
      ) : null}
      <div className="mt-2">
        <Btn label="Link to a person…" type="button" onClick={() => { setError(null); setSheetOpen(true); }} />
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Who is this?">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <SearchablePicker name="person" label="person" search={search} />
          {error ? (
            <p role="alert" className="text-sm text-danger">{error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Btn label="Cancel" type="button" onClick={() => setSheetOpen(false)} />
            <Btn label="Link" primary type="submit" disabled={pendingTransition} />
          </div>
        </form>
      </Sheet>
      {pending ? (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          spec={{
            title: `Link this number to ${pending.label}?`,
            summary: `It will stop matching ${otherMatches.map((m) => m.name).join(", ")}.`,
            confirmLabel: "Link",
          }}
          onConfirm={() => doLink(pending.picked)}
        />
      ) : null}
    </div>
  );
}
