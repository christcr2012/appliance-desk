"use client";

import { useEffect } from "react";
import { MARK_ANY, MARK_PATTERN } from "@/domains/site-content/preview-markers";

/**
 * The owner's "select this content to edit" preview. It exists only in the signed-in preview (the public site never
 * renders it): it removes the invisible marks from the words, remembers which element showed which item, outlines
 * that item when pointed at, and tells the editor window which item was clicked. The message goes only to this same
 * website address, and carries the previewed version so the editor can ignore anything else.
 */
export function PreviewBridge({ keys, revisionId }: { keys: ReadonlyArray<string>; revisionId: string }) {
  useEffect(() => {
    const byElement = new Map<Element, string>();
    const unmark = (raw: string, element: Element | null): string => {
      let first: string | null = null;
      const plain = raw.replace(MARK_PATTERN, (_all, digits: string, inner: string) => {
        const index = Number([...digits].map((c) => c.charCodeAt(0) - 0xe010).join(""));
        first ??= keys[index] ?? null;
        return inner;
      });
      if (first && element && !byElement.has(element)) byElement.set(element, first);
      return plain.replace(MARK_ANY, "");
    };
    for (const element of document.body.querySelectorAll("[data-site-key]")) {
      const key = element.getAttribute("data-site-key");
      if (key && keys.includes(key)) byElement.set(element, key);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue && /[-]/.test(node.nodeValue)) texts.push(node as Text);
    for (const node of texts) node.nodeValue = unmark(node.nodeValue ?? "", node.parentElement);
    for (const element of document.body.querySelectorAll("[alt],[aria-label],[placeholder],[title]")) {
      for (const name of ["alt", "aria-label", "placeholder", "title"]) {
        const value = element.getAttribute(name);
        if (value && /[-]/.test(value)) element.setAttribute(name, unmark(value, element));
      }
    }
    const keyFor = (target: EventTarget | null): { element: Element; key: string } | null => {
      for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
        const key = byElement.get(el);
        if (key) return { element: el, key };
      }
      return null;
    };
    let outlined: HTMLElement | null = null;
    const onOver = (event: MouseEvent) => {
      const hit = keyFor(event.target);
      if (outlined && outlined !== hit?.element) { outlined.style.outline = ""; outlined.style.outlineOffset = ""; outlined = null; }
      if (hit && hit.element instanceof HTMLElement) {
        outlined = hit.element;
        outlined.style.outline = "3px solid #0f766e";
        outlined.style.outlineOffset = "2px";
        outlined.style.cursor = "pointer";
      }
    };
    const onClick = (event: MouseEvent) => {
      const hit = keyFor(event.target);
      event.preventDefault();
      event.stopPropagation();
      if (hit) window.parent.postMessage({ type: "website-select", key: hit.key, revision: revisionId }, window.location.origin);
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("click", onClick, true);
    };
  }, [keys, revisionId]);
  return (
    <p role="note" className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-control bg-ink px-4 py-2 text-sm font-semibold text-surface shadow-lg">
      Click any words, button or photo to edit it.
    </p>
  );
}
