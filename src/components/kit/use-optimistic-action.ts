"use client";
// AR-11: one safe optimistic path for explicitly reversible, non-money actions.
import { unstable_rethrow } from "next/navigation";
import { useOptimistic, useRef, startTransition } from "react";
import { plainError, toast } from "./toaster";
import type { ActionSpec, ConfirmSpec } from "./types";

export type OptimisticFormAction = (fd: FormData) => Promise<unknown>;
export type OptimisticChangeOptions = {
  success: string;
  undo?: () => Promise<unknown>;
  /** Required when adapting a form ActionSpec with a confirmation. Such actions are refused. */
  confirm?: ConfirmSpec;
};

function resultError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const response = result as { ok?: unknown; error?: unknown };
  if (response.ok === false) {
    return typeof response.error === "string" && response.error.trim()
      ? response.error : "That didn't save. Try again.";
  }
  if (typeof response.error === "string" && response.error.trim()) return response.error;
  return null;
}

function sourceAction(action: OptimisticFormAction | Extract<ActionSpec, { kind: "form" }>) {
  return typeof action === "function" ? action : action.action;
}

/** Only for non-money, reversible changes: the action must finish before the success toast. */
export function useOptimisticAction<T, Change>(
  items: T[],
  reducer: (items: T[], change: Change) => T[],
  action: OptimisticFormAction | Extract<ActionSpec, { kind: "form" }>,
): {
  items: T[];
  run: (change: Change, data: FormData, options: OptimisticChangeOptions) => void;
} {
  const [optimisticItems, update] = useOptimistic(items, reducer);
  const pending = useRef(new Set<Change>());

  function run(change: Change, data: FormData, options: OptimisticChangeOptions): void {
    if (options.confirm || (typeof action !== "function" && action.confirm)) {
      throw new Error("An action that asks for confirmation cannot run optimistically.");
    }
    if (pending.current.has(change)) return; // Ignore only another write for the same item.
    pending.current.add(change);
    startTransition(async () => {
      update(change);
      try {
        const result = await sourceAction(action)(data);
        const error = resultError(result);
        if (error) throw new Error(error);
        toast({
          message: options.success,
          tone: "good",
          undo: options.undo
            ? async () => {
                const undone = await options.undo!();
                const undoError = resultError(undone);
                if (undoError) throw new Error(undoError);
              }
            : undefined,
        });
      } catch (error) {
        unstable_rethrow(error);
        toast({ message: plainError(error), tone: "danger" });
      } finally {
        pending.current.delete(change);
      }
    });
  }

  return { items: optimisticItems, run };
}
