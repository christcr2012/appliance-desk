"use client";

import { useEffect, useSyncExternalStore } from "react";

const subscribeNothing = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** Cmd K (Mac) or Ctrl K focuses the desk search box. It shows the key it expects, and does nothing else. */
export function SearchShortcut({ inputId = "global-search" }: { inputId?: string }) {
  // False while the page is first drawn on the server, then the real answer: no flicker of wrong keys, no state in an effect.
  const mac = useSyncExternalStore(subscribeNothing, isMac, () => false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const input = document.getElementById(inputId);
      if (!(input instanceof HTMLInputElement) || input.offsetParent === null) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputId]);

  return (
    <kbd
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-hairline bg-subtle px-1.5 py-0.5 font-sans text-xs text-ink-soft"
    >
      {mac ? "⌘K" : "Ctrl K"}
    </kbd>
  );
}
