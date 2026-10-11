"use client";
import { useEffect, useId, useRef, useState } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

/** Small, keyboard-operable explanation beside an amount or setting. */
export function InfoTip({ term }: { term: GlossaryKey }) {
  const entry = GLOSSARY[term];
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button type="button" aria-label={`What does ${entry.title} mean?`}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full border border-line text-sm text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link">
        ⓘ
      </button>
      {open ? <span id={id} role="note" className="absolute left-0 top-10 z-30 w-72 max-w-[85vw] rounded-card border border-line bg-surface p-3 text-left text-sm text-ink shadow-lg">
        <strong className="block font-semibold">{entry.title}</strong>
        <span className="mt-1 block leading-relaxed">{entry.description}</span>
      </span> : null}
    </span>
  );
}
