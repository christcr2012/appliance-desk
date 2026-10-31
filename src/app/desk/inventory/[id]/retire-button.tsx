"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/kit";
import { retireApplianceAction } from "../actions";

/**
 * AR-6 section 4: Retire lives in the record's actions with a danger
 * confirmation and a REQUIRED reason (fix 3 — the reason is kept, which is
 * why bulk status changes can never retire a unit).
 */
export function RetireApplianceButton({ applianceId }: { applianceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    if (!reason.trim()) {
      setError("Say why it is being retired — the reason stays on the record.");
      return;
    }
    start(async () => {
      const result = await retireApplianceAction(applianceId, { reason });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="quiet"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Retire…
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        spec={{
          title: "Retire this appliance?",
          summary:
            "It leaves the fleet for good and can no longer be rented. The reason you give is kept on its record.",
          confirmLabel: pending ? "Retiring…" : "Retire it",
          danger: true,
        }}
        onConfirm={confirm}
        details={
          <div>
            <label htmlFor="retire-reason" className="block text-sm font-medium text-ink-soft">
              Why is it being retired?
            </label>
            <input
              id="retire-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="e.g. motor failed, not worth repairing"
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
            {error && (
              <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                {error}
              </p>
            )}
          </div>
        }
      />
    </>
  );
}
