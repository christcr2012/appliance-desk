"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Card, Checkbox, Field } from "@/components/ui";
import { signOut } from "@/lib/auth-client";
import {
  changePasswordAction,
  makeBackupCodesAction,
  requestEmailChangeAction,
  saveProfileAction,
  signOutOtherDevicesAction,
  turnOffTwoStepAction,
  type AccountActionResult,
} from "./actions";

type Device = { id: string; device: string; lastActiveAt: string; current: boolean };

function Result({ result }: { result: AccountActionResult | null }) {
  if (!result) return null;
  return result.status === "error" ? (
    <p role="alert" className="mt-3 text-sm font-semibold text-danger">{result.message}</p>
  ) : (
    <p role="status" className="mt-3 text-sm text-success">{result.message}</p>
  );
}

function when(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(value));
}

export function ProfileCard({ name, phone, phoneConfirmed }: { name: string; phone: string | null; phoneConfirmed: boolean }) {
  const [nameValue, setName] = useState(name);
  const [phoneValue, setPhone] = useState(phone ? phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3") : "");
  const [result, setResult] = useState<AccountActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card title="Your details" description="Your name shows on the work you do. Your phone number is kept for sign-in codes.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => setResult(await saveProfileAction({ name: nameValue, phone: phoneValue })));
        }}
      >
        <Field label="Name" name="name" autoComplete="name" required value={nameValue} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Mobile phone (optional)"
          name="phone"
          type="tel"
          autoComplete="tel"
          value={phoneValue}
          onChange={(e) => setPhone(e.target.value)}
          help={phone ? (phoneConfirmed ? "Confirmed." : "Saved, not confirmed yet. Codes by text come later.") : "A US number, like 970-555-0123."}
        />
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save details"}</Button>
      </form>
      <Result result={result} />
    </Card>
  );
}

export function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [result, setResult] = useState<AccountActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card title="Password" description="Use at least 10 characters. You will get an email so a change you did not make is noticed.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const answer = await changePasswordAction({ currentPassword: current, newPassword: next, signOutOthers });
            setResult(answer);
            if (answer.status === "success") { setCurrent(""); setNext(""); }
          });
        }}
      >
        <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Field label="New password" name="newPassword" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
        <Checkbox label="Sign me out on my other devices" checked={signOutOthers} onChange={(e) => setSignOutOthers(e.target.checked)} />
        <Button type="submit" disabled={pending}>{pending ? "Changing…" : "Change password"}</Button>
      </form>
      <Result result={result} />
    </Card>
  );
}

export function EmailCard({ email }: { email: string }) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<AccountActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card title="Sign-in email" description={`You sign in with ${email}. A link goes to the new address, and nothing changes until you open it.`}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const answer = await requestEmailChangeAction({ newEmail, currentPassword: password });
            setResult(answer);
            if (answer.status === "success") { setNewEmail(""); setPassword(""); }
          });
        }}
      >
        <Field label="New email address" name="newEmail" type="email" autoComplete="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        <Field label="Your current password" name="emailPassword" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send the confirmation link"}</Button>
      </form>
      <Result result={result} />
    </Card>
  );
}

export function DevicesCard({ devices }: { devices: Device[] }) {
  const [result, setResult] = useState<AccountActionResult | null>(null);
  const [rows, setRows] = useState(devices);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card title="Your signed-in devices" description="Devices that are signed in to your account right now.">
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id} className="py-2 text-sm first:pt-0">
            <span className="font-semibold text-ink">{row.device}</span>{row.current ? " (this device)" : ""}
            <span className="block text-ink-soft">Last used {when(row.lastActiveAt)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={pending || rows.length < 2}
          onClick={() => start(async () => {
            const answer = await signOutOtherDevicesAction();
            setResult(answer);
            if (answer.status === "success") setRows((current) => current.filter((row) => row.current));
          })}
        >
          Sign out my other devices
        </Button>
        <Button variant="secondary" onClick={() => { void signOut({ fetchOptions: { onSuccess: () => router.push("/login") } }); }}>
          Sign out this device
        </Button>
      </div>
      <Result result={result} />
    </Card>
  );
}

export function TwoStepCard({ enabled, required }: { enabled: boolean; required: boolean }) {
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<AccountActionResult | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card
      title="Two-step sign-in"
      description={enabled ? "On. After your password you also enter a code from your authenticator app." : "Off. Two-step sign-in asks for a code from your phone after your password."}
    >
      {!enabled && (
        <Link className="font-semibold text-action underline" href="/desk/security/setup">Set up two-step sign-in</Link>
      )}
      {enabled && (
        <div className="space-y-4">
          <Field label="Your current password" name="twoStepPassword" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} help="Needed to make new backup codes or turn two-step sign-in off." />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={pending || password === ""}
              onClick={() => start(async () => {
                const answer = await makeBackupCodesAction({ currentPassword: password });
                setResult(answer);
                setCodes(answer.status === "success" ? answer.backupCodes ?? null : null);
                setPassword("");
              })}
            >
              Make new backup codes
            </Button>
            {!required && (
              <Button
                variant="secondary"
                disabled={pending || password === ""}
                onClick={() => start(async () => {
                  const answer = await turnOffTwoStepAction({ currentPassword: password });
                  if (answer) setResult(answer);
                })}
              >
                Turn two-step sign-in off
              </Button>
            )}
          </div>
          {required && <p className="text-sm text-ink-soft">Your role has to keep two-step sign-in on, so there is no switch to turn it off.</p>}
        </div>
      )}
      <Result result={result} />
      {codes && (
        <div className="mt-3 rounded-control border border-line p-3">
          <p className="text-sm font-semibold text-ink">Backup codes (shown once; keep them away from your phone)</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((code) => <li key={code}>{code}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}
