"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { signOutOtherSessionsAction } from "./actions";

type SessionRow = {
  id: string;
  device: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
};

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Denver",
  }).format(new Date(value));
}

export function SessionControls({ sessions }: { sessions: SessionRow[] }) {
  const [rows, setRows] = useState(sessions);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function signOutOthers() {
    setMessage(null);
    startTransition(async () => {
      const result = await signOutOtherSessionsAction();
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      setRows((current) => current.filter((row) => row.current));
      setMessage(
        result.revokedCount === 0
          ? "No other signed-in sessions were found."
          : `Signed out ${result.revokedCount} other session${result.revokedCount === 1 ? "" : "s"}.`,
      );
    });
  }

  return (
    <div className="mt-6 border-t border-line pt-6">
      <h3 className="font-medium text-ink">Your signed-in devices</h3>
      <p className="mt-1 text-sm text-ink-soft">
        Last active is based on the last time Appliance Desk refreshed that session.
      </p>
      <ul className="mt-4 divide-y divide-line rounded-card border border-line">
        {rows.map((row) => (
          <li key={row.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">{row.device}</span>
              {row.current && (
                <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-ink">
                  This device
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              Last active {formatWhen(row.lastActiveAt)} · Signed in {formatWhen(row.createdAt)}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || rows.every((row) => row.current)}
          onClick={signOutOthers}
        >
          {isPending ? "Signing out…" : "Sign out everywhere else"}
        </Button>
      </div>
      {message && (
        <p role="status" className="mt-2 text-sm font-medium text-success">
          {message}
        </p>
      )}
    </div>
  );
}
