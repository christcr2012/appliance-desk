"use client";
// Shared runner for `form` ActionSpecs: calls the server action, then reports the result with a toast (KIT 6.2/6.3).
import { unstable_rethrow } from "next/navigation";
import { plainError, toast } from "./toaster";
import type { ActionSpec } from "./types";

type FormSpec = Extract<ActionSpec, { kind: "form" }>;

export function fieldsToFormData(fields: Record<string, string> | undefined, base?: FormData): FormData {
  const data = base ?? new FormData();
  for (const [name, value] of Object.entries(fields ?? {})) if (!data.has(name)) data.set(name, value);
  return data;
}

/** Plain message a server action returned as `{ error: "…" }` (the existing actions' result shape), if any. */
function returnedError(result: unknown): string | null {
  if (result && typeof result === "object" && "error" in result) {
    const error = (result as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return null;
}

function returnedSuccess(result: unknown): string | null {
  if (result && typeof result === "object" && "success" in result) {
    const success = (result as { success?: unknown }).success;
    if (typeof success === "string" && success.trim()) return success;
  }
  return null;
}

/** Run a form ActionSpec once. Never throws for an ordinary failure; Next.js redirects and not-found still pass through. */
export async function runFormAction(spec: FormSpec, data: FormData): Promise<boolean> {
  try {
    const result = await spec.action(data);
    const error = returnedError(result);
    if (error) {
      toast({ message: error, tone: "danger" });
      return false;
    }
    const message = spec.successMessage ?? returnedSuccess(result);
    const undoAction = spec.undo && !spec.confirm ? spec.undoAction : undefined;
    if (message || undoAction) {
      toast({
        message: message ?? "Done",
        tone: "good",
        undo: undoAction
          ? async () => {
              const result = await undoAction(fieldsToFormData(spec.fields));
              const undoError = returnedError(result);
              if (undoError) throw new Error(undoError);
            }
          : undefined,
      });
    }
    return true;
  } catch (error) {
    unstable_rethrow(error);
    toast({ message: plainError(error), tone: "danger" });
    return false;
  }
}
