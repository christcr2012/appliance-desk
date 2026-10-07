"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { signOutOtherSessionsAction } from "./actions";

type SessionRow = {
  id: string;
  device: string;
  created: string;
  lastActive: string;
  current: boolean;
};

export function SessionControlSection({
  sessions,
}: {
  sessions: SessionRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function signOutOthers() {
    setMessage(null);
    startTransition(async () => {
      const result = await signOutOtherSessionsAction();
      setMessage(
        result.status === "error"
          ? result.message
          : result.revoked === 0
            ? "There were no other active sessions."
            : `Signed out ${result.revoked} other session${result.revoked === 1 ? "" : "s"}.`,
      );
    });
  }

  return (
    <div className="mt-6 border-t border-line pt-6">
      <h3 className="font-medium text-ink">Your signed-in devices</h3>
      <p className="mt-1 text-sm text-ink-soft">
        Review where this account is signed in. “Last active” is the last time that session was refreshed.
      </p>
      <div className="mt-4 space-y-3">
        {sessions.length === 0 ? (
          <p className="text-sm text-ink-soft">No active sessions were found.</p>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="rounded-card border border-line bg-subtle p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{session.device}</span>
                {session.current && (
                  <span className="rounded-full border border-line-strong px-2 py-0.5 text-xs font-medium text-ink">
                    This device
                  </span>
                )}
              </div>
              <p className="mt-1 text-ink-soft">Last active: {session.lastActive}</p>
              <p className="text-ink-soft">Signed in: {session.created}</p>
            </div>
          ))
        )}
      </div>
      <div className="mt-4">
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={signOutOthers}
        >
          {isPending ? "Signing out…" : "Sign out everywhere else"}
        </Button>
      </div>
      {message && <p role="status" className="mt-2 text-sm text-ink-soft">{message}</p>}
    </div>
  );
}
