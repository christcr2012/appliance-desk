"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaskAction } from "./actions";
import { Button } from "@/components/ui";

import { TaskFields, readTaskFields, type TaskAssignee } from "./task-fields";

export function NewTaskForm({
  assignees = [],
  link,
  initialNote = "",
}: {
  assignees?: TaskAssignee[];
  link?: { leadId?: string; customerId?: string; jobId?: string };
  initialNote?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  function showError(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }
  return (
    <form
      ref={formRef}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = readTaskFields(e.currentTarget);
        setError(null);
        setSaved(false);
        startTransition(async () => {
          try {
            const result = await createTaskAction({
              ...data,
              ...link,
            });
            if (result.status !== "success") {
              showError(result.message);
              return;
            }
            formRef.current?.reset();
            setSaved(true);
            router.refresh();
          } catch {
            showError(
              "Couldn't confirm this task was saved. Your text is preserved. Check the list before trying again.",
            );
          }
        });
      }}
    >
      <TaskFields
        assignees={assignees}
        disabled={isPending}
        note={initialNote}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding…" : "Add task"}
        </Button>
      </div>
      {error && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="text-sm text-ink"
        >
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-ink">
          Task added.
        </p>
      )}
    </form>
  );
}
