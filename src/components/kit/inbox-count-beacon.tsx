"use client";
import { useEffect, useState } from "react";
const KEY = "desk.inboxCount";

/** The Today page alone already queries this number. Other screens read this tab's last-known count. */
export function InboxCountBeacon({ count }: { count: number }) {
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, String(Math.max(0, Math.floor(count))));
      window.dispatchEvent(new Event("desk:inbox-count"));
    } catch { /* storage unavailable */ }
  }, [count]);
  return null;
}

function readCount(): number {
  try {
    const value = Number(sessionStorage.getItem(KEY) ?? "0");
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  } catch { return 0; }
}

export function InboxCountPill() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(readCount());
    update();
    window.addEventListener("desk:inbox-count", update);
    return () => window.removeEventListener("desk:inbox-count", update);
  }, []);
  if (count === 0) return null;
  return <span aria-label={`${count} inbox items`}
    className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-bold text-on-primary">
    {count > 99 ? "99+" : count}
  </span>;
}
