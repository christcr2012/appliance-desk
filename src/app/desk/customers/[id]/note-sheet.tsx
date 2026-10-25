"use client";
// AR-0b (CUSTOMER-RECORD 4.6): "Add a note" opens a sheet holding the existing AddNoteForm. Every "Add a note" on the
// record is a real link (?note=1), so it works before this script loads; here the click is caught and the sheet opens
// in place. It also shows the one-time "Account created" message as a toast.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Sheet, toast } from "@/components/kit";
import { AddNoteForm } from "./add-note-form";

export function CustomerRecordClient({
  customerId,
  initialNoteOpen,
  accountNotice,
  children,
}: {
  customerId: string;
  initialNoteOpen: boolean;
  accountNotice?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? `/desk/customers/${customerId}`;
  const search = useSearchParams()?.toString() ?? "";
  const [open, setOpen] = useState(initialNoteOpen);
  const announced = useRef(false);

  useEffect(() => {
    if (!accountNotice || announced.current) return;
    announced.current = true;
    toast({ message: accountNotice, tone: accountNotice.includes("didn't") ? "attention" : "good" });
  }, [accountNotice]);

  function dropNoteParam() {
    const params = new URLSearchParams(search);
    if (!params.has("note")) return;
    params.delete("note");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!anchor) return;
    try {
      const url = new URL(anchor.getAttribute("href") ?? "", window.location.href);
      if (url.pathname !== pathname || url.searchParams.get("note") !== "1") return;
    } catch {
      return;
    }
    event.preventDefault();
    setOpen(true);
  }

  return (
    // The kit lays out for a 20 px phone gutter (KIT 1); the current shell gives 16 px, so add the difference until AR-1.
    <div onClickCapture={onClickCapture} className="px-1 sm:px-0">
      {children}
      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) dropNoteParam();
        }}
        title="Add a note"
      >
        <AddNoteForm
          customerId={customerId}
          onSaved={() => {
            setOpen(false);
            toast({ message: "Note added", tone: "good" });
          }}
        />
      </Sheet>
    </div>
  );
}
