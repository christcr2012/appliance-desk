"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field } from "@/components/ui";
import { METHOD_LABEL, type SecondStepMethod } from "@/domains/security/second-step-rules";
import { confirmPhoneAction, confirmSwitchAction, startPhoneCheckAction, startSwitchAction } from "../security/actions";

type Msg = { kind: "success" | "error"; text: string };

export function SecondStepCard({ method, enrolled, allowed, notAllowedAnymore, phone, phoneConfirmed, textCodesReady }: {
  method: SecondStepMethod | null; enrolled: boolean; allowed: SecondStepMethod[]; notAllowedAnymore: boolean;
  phone: string | null; phoneConfirmed: boolean; textCodesReady: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg | null>(null);
  const [phoneStep, setPhoneStep] = useState<"idle" | "sent">("idle");
  const [phoneCode, setPhoneCode] = useState("");
  const [switching, setSwitching] = useState<SecondStepMethod | null>(null);
  const [switchCode, setSwitchCode] = useState("");
  const [done, setDone] = useState({ phone: phoneConfirmed, method });

  function show(result: { status: "success"; message?: string } | { status: "error"; message: string }) {
    setMsg(result.status === "error" ? { kind: "error", text: result.message } : { kind: "success", text: result.message ?? "Done." });
    return result.status === "success";
  }

  const switchTargets = allowed.filter((m) => (m === "SMS" || m === "EMAIL") && m !== done.method && !(m === "SMS" && !textCodesReady));

  return (
    <Card title="Second step: how you get your code">
      <div className="space-y-4 text-sm">
        <p className="text-ink">
          Current method: <strong>{done.method ? METHOD_LABEL[done.method] : "not set up yet"}</strong>
          {!enrolled && <> (<a className="underline" href="/desk/security/setup">set it up</a>)</>}
        </p>
        {notAllowedAnymore && (
          <p role="status" className="rounded-control border border-line p-3 text-ink">
            The owner&rsquo;s rules no longer include this method. It keeps working for now, but please switch below when you can.
          </p>
        )}

        {phone && !done.phone && (
          <div className="space-y-2">
            <p className="text-ink-soft">Your phone number is saved but not checked yet. A text code proves it is yours (needed for text sign-in codes).</p>
            {!textCodesReady ? (
              <p className="text-ink-soft">Text codes are not switched on yet, so a phone cannot be checked right now.</p>
            ) : phoneStep === "idle" ? (
              <Button type="button" variant="secondary" disabled={pending} onClick={() => start(async () => { if (show(await startPhoneCheckAction())) setPhoneStep("sent"); })}>Text me a code</Button>
            ) : (
              <form className="max-w-xs space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => { if (show(await confirmPhoneAction(phoneCode))) { setDone((d) => ({ ...d, phone: true })); setPhoneStep("idle"); } }); }}>
                <Field id="phoneCheckCode" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" value={phoneCode} onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                <Button type="submit" disabled={pending || phoneCode.length !== 6}>Check my phone</Button>
              </form>
            )}
          </div>
        )}
        {phone && done.phone && <p className="text-ink-soft">Your phone number is checked.</p>}

        {enrolled && switchTargets.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium text-ink">Switch method</p>
            <div className="flex flex-wrap gap-2">
              {switchTargets.map((m) => (
                <Button key={m} type="button" variant="secondary" disabled={pending} onClick={() => start(async () => { if (show(await startSwitchAction(m))) { setSwitching(m); setSwitchCode(""); } })}>
                  Switch to {METHOD_LABEL[m].toLowerCase()}
                </Button>
              ))}
            </div>
            {switching && (
              <form className="max-w-xs space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => { if (show(await confirmSwitchAction(switching, switchCode))) { setDone((d) => ({ ...d, method: switching })); setSwitching(null); } }); }}>
                <Field id="switchCode" label="6-digit code we just sent" inputMode="numeric" autoComplete="one-time-code" value={switchCode} onChange={(e) => setSwitchCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                <Button type="submit" disabled={pending || switchCode.length !== 6}>Confirm switch</Button>
              </form>
            )}
            <p className="text-ink-soft">Switching to the authenticator app is not available here yet. Backup codes keep working whichever method you use.</p>
          </div>
        )}
        {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`font-medium ${msg.kind === "error" ? "text-danger" : "text-success"}`}>{msg.text}</p>}
      </div>
    </Card>
  );
}
