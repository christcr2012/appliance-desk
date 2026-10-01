"use client";

import { useActionState } from "react";
import type { PreviewStorageResult } from "@/domains/preview-storage";
import { primaryActionClass } from "@/components/desk/workspace";
import { runPreviewStorageCheck } from "./actions";

export function PreviewStorageCheckForm() {
  const [state, action, pending] = useActionState<PreviewStorageResult>(
    runPreviewStorageCheck, { status: "idle" },
  );
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-ink-soft">
        This creates a tiny synthetic file, reads it privately, checks that
        access without a token is refused, then removes the test file.
      </p>
      <button disabled={pending || state.cleanupPending} className={primaryActionClass}>
        {pending ? "Checking storage…" : "Run preview storage check"}
      </button>
      {state.message && (
        <div role={state.status === "error" ? "alert" : "status"} className="space-y-2">
          <p>{state.message}</p>
          {state.fixturePath && <p className="break-all text-sm text-ink-soft">Test file: {state.fixturePath}</p>}
        </div>
      )}
    </form>
  );
}
