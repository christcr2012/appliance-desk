"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field } from "@/components/ui";
import { decideSafetyIncidentAction } from "../../actions";

export function IncidentDecision({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  function decide(decision: "REPORTED" | "NOT_REPORTED") {
    setMessage(null);
    start(async () => {
      const result = await decideSafetyIncidentAction(incidentId, { decision, note });
      if (result.status === "error") return setMessage(result.message);
      router.refresh();
    });
  }
  return (
    <Card title="Your decision">
      <div className="grid gap-3 sm:max-w-md">
        <Field id="incident-note" label="What did you decide, and why?" value={note} onChange={(e) => setNote(e.target.value)} required />
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => decide("REPORTED")}>I reported it</Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => decide("NOT_REPORTED")}>I decided not to report it</Button>
        </div>
        {message && <p role="alert" className="text-sm font-semibold text-danger">{message}</p>}
      </div>
    </Card>
  );
}
