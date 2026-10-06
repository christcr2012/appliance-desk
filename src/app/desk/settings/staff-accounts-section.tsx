"use client";

import { useState, useTransition } from "react";
import {
  createStaffAccountAction,
  deactivateStaffAccountAction,
  reactivateStaffAccountAction,
  resendStaffActivationEmailAction,
} from "./actions";
import { StatusBadge } from "@/components/status-badge";

type StaffAccountRow = {
  id: string;
  name: string | null;
  email: string;
  createdAt: Date;
  isActive: boolean;
};

export function StaffAccountsSection({ accounts }: { accounts: StaffAccountRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [formMessage, setFormMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [rowMessage, setRowMessage] = useState<
    Record<string, { kind: "success" | "error"; text: string }>
  >({});

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormMessage(null);
    startTransition(async () => {
      const result = await createStaffAccountAction({ name, email });
      if (result.status === "error") {
        setFormMessage({ kind: "error", text: result.message });
      } else {
        setFormMessage({
          kind: result.activationEmailSent ? "success" : "error",
          text: result.activationEmailSent
            ? `Account created. We emailed ${email} a link to set their password.`
            : "Account created, but the setup email was not sent. Use Resend setup email on this account to retry; do not create another account.",
        });
        setName("");
        setEmail("");
      }
    });
  }

  function handleDeactivate(id: string) {
    startTransition(async () => {
      const result = await deactivateStaffAccountAction(id);
      setRowMessage((m) => ({
        ...m,
        [id]:
          result.status === "error"
            ? { kind: "error", text: result.message }
            : { kind: "success", text: "Access removed." },
      }));
    });
  }

  function handleReactivate(id: string) {
    startTransition(async () => {
      const result = await reactivateStaffAccountAction(id);
      setRowMessage((m) => ({
        ...m,
        [id]:
          result.status === "error"
            ? { kind: "error", text: result.message }
            : { kind: "success", text: "Access restored." },
      }));
    });
  }

  function handleResend(email: string, id: string) {
    startTransition(async () => {
      const result = await resendStaffActivationEmailAction(email);
      setRowMessage((m) => ({
        ...m,
        [id]:
          result.status === "error"
            ? { kind: "error", text: result.message }
            : { kind: "success", text: "Email sent." },
      }));
    });
  }

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-ink-soft">
        A staff login can see day-to-day work — jobs, dispatch, customers,
        inventory, maintenance — but not revenue, billing, reports, or these
        settings. Only you (and any other owner/admin account) see the
        money side.
      </p>

      {accounts.length === 0 ? (
        <p className="text-sm text-ink-soft">No staff accounts yet.</p>
      ) : (
        <div className="max-w-2xl overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-2 pr-4 font-medium text-ink">Name</th>
                <th className="py-2 pr-4 font-medium text-ink">Email</th>
                <th className="py-2 pr-4 font-medium text-ink">Status</th>
                <th className="py-2 pr-4 font-medium text-ink">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-line align-top">
                  <td className="py-2 pr-4 text-ink">{a.name ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink-soft">{a.email}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge
                      tone={a.isActive ? "success" : "stopped"}
                      label={a.isActive ? "Active" : "Removed"}
                      variant="pill"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-2">
                      {a.isActive ? (
                        <>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleResend(a.email, a.id)}
                            className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink-soft hover:border-line-strong disabled:opacity-50"
                          >
                            Resend setup email
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleDeactivate(a.id)}
                            className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:border-red-400 disabled:opacity-50"
                          >
                            Remove access
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleReactivate(a.id)}
                          className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink-soft hover:border-line-strong disabled:opacity-50"
                        >
                          Restore access
                        </button>
                      )}
                    </div>
                    {rowMessage[a.id] && (
                      <p
                        role={rowMessage[a.id].kind === "error" ? "alert" : "status"}
                        className={`mt-1 text-xs ${
                          rowMessage[a.id].kind === "error"
                            ? "text-red-700"
                            : "text-green-700"
                        }`}
                      >
                        {rowMessage[a.id].text}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="max-w-md space-y-3 border-t border-line pt-4"
      >
        <h3 className="text-sm font-medium text-ink">Add a staff account</h3>
        <div>
          <label htmlFor="staffName" className="block text-sm font-medium text-ink-soft">
            Name
          </label>
          <input
            id="staffName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="staffEmail" className="block text-sm font-medium text-ink-soft">
            Email
          </label>
          <input
            id="staffEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink-faint">
            They&apos;ll get an email with a link to set their own password —
            you never see or choose it.
          </p>
        </div>
        <button
          type="submit"
          disabled={isPending || !name || !email}
          className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add staff account"}
        </button>
        {formMessage && (
          <p
            role={formMessage.kind === "error" ? "alert" : "status"}
            className={`text-sm ${
              formMessage.kind === "error" ? "text-red-700" : "text-green-700"
            }`}
          >
            {formMessage.text}
          </p>
        )}
      </form>
    </div>
  );
}
