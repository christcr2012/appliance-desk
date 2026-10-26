"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { checkWholeFleetAction } from "./actions";

export function FleetCheckButton() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button" variant="secondary" disabled={pending}
        onClick={() => start(async () => {
          const result = await checkWholeFleetAction();
          setMessage(result.status === "error" ? { ok: false, text: result.message } : { ok: true, text: result.status === "success" ? result.message ?? "Saved." : "" });
        })}
      >
        {pending ? "Saving…" : "Check my whole fleet"}
      </Button>
      {message && <p role={message.ok ? "status" : "alert"} className={`text-sm font-semibold ${message.ok ? "text-ink" : "text-danger"}`}>{message.text}</p>}
    </div>
  );
}
