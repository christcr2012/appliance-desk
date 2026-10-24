"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Field } from "@/components/ui";
import { acceptInvitationAction } from "./actions";

export function JoinForm({ code, name, email, accessLevel }: { code: string; name: string; email: string; accessLevel: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        <p>Your account is ready.</p>
        <p className="mt-2"><Link href="/login" className="text-primary hover:underline">Sign in now</Link></p>
      </div>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await acceptInvitationAction(code, password, confirm);
      if (result.status === "error") setError(result.message);
      else setDone(true);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <dl className="space-y-1 rounded-lg border border-line p-3 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-ink-soft">Name</dt><dd className="text-ink">{name}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-ink-soft">Email</dt><dd className="text-ink">{email}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-ink-soft">Access level</dt><dd className="text-ink">{accessLevel}</dd></div>
      </dl>
      <p className="text-sm text-ink-soft">Choose a password for your account. If any of this looks wrong, do not continue; ask the owner.</p>
      <Field id="joinPassword" label="Password" help="At least 10 characters." type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Field id="joinConfirm" label="Type it again" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" disabled={pending || !password || !confirm}>{pending ? "Setting up…" : "Create my account"}</Button>
    </form>
  );
}
