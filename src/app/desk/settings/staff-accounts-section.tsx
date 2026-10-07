"use client";

import { useState, useTransition } from "react";
import {
  Button,
  DataList,
  EmptyState,
  Field,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
import {
  createStaffAccountAction,
  deactivateStaffAccountAction,
  reactivateStaffAccountAction,
  resendStaffActivationEmailAction,
  signOutStaffEverywhereAction,
} from "./actions";

type StaffAccountRow = {
  id: string;
  name: string | null;
  email: string;
  createdAt: Date;
  isActive: boolean;
};

export function StaffAccountsSection({
  accounts,
  canSignOutEverywhere,
}: {
  accounts: StaffAccountRow[];
  canSignOutEverywhere: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [formMessage, setFormMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [rowMessage, setRowMessage] = useState<
    Record<string, { kind: "success" | "error"; text: string }>
  >({});

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
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
      setRowMessage((current) => ({
        ...current,
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
      setRowMessage((current) => ({
        ...current,
        [id]:
          result.status === "error"
            ? { kind: "error", text: result.message }
            : { kind: "success", text: "Access restored." },
      }));
    });
  }

  function handleSignOutEverywhere(id: string) {
    startTransition(async () => {
      const result = await signOutStaffEverywhereAction(id);
      setRowMessage((current) => ({
        ...current,
        [id]:
          result.status === "error"
            ? { kind: "error", text: result.message }
            : {
                kind: "success",
                text:
                  (result.revoked ?? 0) === 0
                    ? "No active sessions were found."
                    : `Signed out ${result.revoked} session${result.revoked === 1 ? "" : "s"}.`,
              },
      }));
    });
  }

  function handleResend(emailAddress: string, id: string) {
    startTransition(async () => {
      const result = await resendStaffActivationEmailAction(emailAddress);
      setRowMessage((current) => ({
        ...current,
        [id]:
          result.status === "error"
            ? { kind: "error", text: result.message }
            : { kind: "success", text: "Email sent." },
      }));
    });
  }

  const columns: DataListColumn<StaffAccountRow>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      cell: (account) => account.name ?? "—",
    },
    {
      key: "email",
      header: "Email",
      cell: (account) => account.email,
    },
    {
      key: "status",
      header: "Status",
      cell: (account) => (
        <StatusPill
          tone={account.isActive ? "success" : "stopped"}
          label={account.isActive ? "Active" : "Removed"}
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (account) => (
        <div>
          <div className="flex flex-wrap gap-2">
            {account.isActive ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => handleResend(account.email, account.id)}
                >
                  Resend setup email
                </Button>
                {canSignOutEverywhere && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => handleSignOutEverywhere(account.id)}
                  >
                    Sign this person out everywhere
                  </Button>
                )}
                <Button
                  type="button"
                  variant="danger"
                  disabled={isPending}
                  onClick={() => handleDeactivate(account.id)}
                >
                  Remove access
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() => handleReactivate(account.id)}
              >
                Restore access
              </Button>
            )}
          </div>
          {rowMessage[account.id] && (
            <p
              role={
                rowMessage[account.id].kind === "error" ? "alert" : "status"
              }
              className={`mt-2 text-sm font-medium ${
                rowMessage[account.id].kind === "error"
                  ? "text-danger"
                  : "text-success"
              }`}
            >
              {rowMessage[account.id].text}
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-ink-soft">
        A staff login can see day-to-day work — jobs, dispatch, customers,
        inventory, maintenance — but not revenue, billing, reports, or these
        settings. Only you (and any other owner/admin account) see the money side.
      </p>

      <DataList
        rows={accounts}
        columns={columns}
        caption="Staff accounts"
        empty={
          <EmptyState
            title="No staff accounts yet"
            description="Add a staff account below when someone needs operational access."
          />
        }
      />

      <form
        onSubmit={handleCreate}
        className="max-w-md space-y-4 border-t border-line pt-6"
      >
        <h3 className="font-semibold text-ink">Add a staff account</h3>
        <Field
          id="staffName"
          label="Name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Field
          id="staffEmail"
          label="Email"
          help="They’ll get an email with a link to set their own password — you never see or choose it."
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" disabled={isPending || !name || !email}>
          {isPending ? "Adding…" : "Add staff account"}
        </Button>
        {formMessage && (
          <p
            role={formMessage.kind === "error" ? "alert" : "status"}
            className={`text-sm font-medium ${
              formMessage.kind === "error" ? "text-danger" : "text-success"
            }`}
          >
            {formMessage.text}
          </p>
        )}
      </form>
    </div>
  );
}
