"use client";

import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import {
  confirmCodeAction,
  pauseChargesAction,
  requestAccessAction,
  sendCodeAction,
  type EmergencyFlowState,
} from "./actions";
import type { PublicEmergencyState } from "@/domains/vault/emergency";

const initial: EmergencyFlowState = { status: "idle" };

function denver(dateIso: string): string {
  return new Date(dateIso).toLocaleString("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function FlowMessages({ state }: { state: EmergencyFlowState }) {
  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm font-semibold text-danger">
        {state.message}
      </p>
    );
  }
  if (state.status === "done") return <p className="text-sm text-ink-soft">{state.message}</p>;
  return null;
}

/**
 * VAULT-2: the emergency contact's side of the flow. The page itself decides
 * which step to show from the server state; this component only runs the
 * step's action and reports back. Nothing here can choose where the code
 * goes — it always goes to the contact details the owner saved.
 */
export function EmergencyFlow({ token, state }: { token: string; state: PublicEmergencyState }) {
  const [requestState, requestAction, requestPending] = useActionState(requestAccessAction.bind(null, token), initial);
  const [sendState, sendAction, sendPending] = useActionState(sendCodeAction.bind(null, token), initial);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmCodeAction.bind(null, token), initial);
  const [pauseState, pauseAction, pausePending] = useActionState(pauseChargesAction.bind(null, token), initial);

  const pauseSection = (chargesPaused: boolean) => (
    <section aria-labelledby="pause-heading" className="space-y-3 rounded-control border border-line p-4">
      <h2 id="pause-heading" className="text-base font-semibold">Pause automatic charges</h2>
      <p>
        This stops the business from starting new charges, adding late fees or sending past-due and reminder
        messages until the owner turns them back on. It does not refund, cancel or change anything already billed or
        signed, and customers can still pay on their own. Only the owner can turn charges back on. The owner is told
        right away.
      </p>
      {chargesPaused || pauseState.status === "done" ? (
        <p role="status" className="text-sm font-semibold">Automatic charges are paused.</p>
      ) : (
        <form action={pauseAction}>
          <Button type="submit" variant="secondary" disabled={pausePending}>
            {pausePending ? "Pausing…" : "Pause all automatic charges"}
          </Button>
        </form>
      )}
      <FlowMessages state={pauseState} />
    </section>
  );

  switch (state.state) {
    case "inactive":
      return (
        <p>
          This link isn&apos;t active. Emergency access may be switched off, or the owner may have replaced this
          link with a newer one. If you need the records urgently, contact the owner directly.
        </p>
      );
    case "ready":
      return (
        <div className="space-y-4">
          <p>
            Hello {state.contactName}. The owner of Robinson Appliance Rentals set you up as their emergency
            contact. If something has happened to them, you can ask for a read-only copy of the business records
            and logins.
          </p>
          <p>
            Asking starts a waiting period. The owner is told right away — by email and text — and can deny the
            request at any time before you download. Nothing is shared until the wait ends and you confirm a code
            sent to the phone or email the owner saved for you.
          </p>
          <form action={requestAction}>
            <Button type="submit" disabled={requestPending}>
              {requestPending ? "Starting…" : "Request emergency access"}
            </Button>
          </form>
          <FlowMessages state={requestState} />
        </div>
      );
    case "waiting":
      return (
        <div className="space-y-4">
          <p>
            Your request is in. The waiting period ends <strong>{denver(state.waitEndsAt)}</strong>.{" "}
            {state.ownerNoticeFailed
              ? "We're having trouble reaching the owner — the app keeps retrying, and the owner can still deny the request."
              : "The owner has been told and can still deny the request."}
          </p>
          <p>Come back to this same link after the wait ends to confirm a code and download the export.</p>
        </div>
      );
    case "denied":
      return <p>The owner denied this request, so nothing was shared. If that&apos;s a mistake, contact them directly.</p>;
    case "ready_for_code":
      return (
        <div className="space-y-4">
          <p>
            The waiting period is over and the owner hasn&apos;t denied the request. Ask for your one-time code —
            it goes to the phone or email the owner saved for you, and works for 15 minutes.
          </p>
          <form action={sendAction}>
            <Button type="submit" disabled={sendPending}>
              {sendPending ? "Sending…" : "Send me the code"}
            </Button>
          </form>
          <FlowMessages state={sendState} />
        </div>
      );
    case "code_sent":
      return (
        <div className="space-y-4">
          <p>Type the 6-digit code sent to your saved phone or email. Five wrong tries cancel the code.</p>
          <form action={confirmAction} className="space-y-3">
            <Field label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" />
            <Button type="submit" disabled={confirmPending}>
              {confirmPending ? "Checking…" : "Confirm code"}
            </Button>
          </form>
          <FlowMessages state={confirmState} />
          <form action={sendAction}>
            <Button type="submit" variant="secondary" disabled={sendPending}>
              Send a new code
            </Button>
          </form>
          <FlowMessages state={sendState} />
        </div>
      );
    case "verified":
      return (
        <div className="space-y-4">
          <p>
            Your code checked out. You can download one copy of the export — the business records pack plus the
            logins as a PDF. The download works once, and this link stops working{" "}
            <strong>{denver(state.exportExpiresAt)}</strong>.
          </p>
          <p>
            <a
              href={`/emergency/${token}/download`}
              className="inline-flex min-h-11 items-center justify-center rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action hover:opacity-90"
            >
              Download the export (.zip)
            </a>
          </p>
          <p className="text-sm text-ink-soft">The download is recorded in the app&apos;s activity log.</p>
          {pauseSection(state.chargesPaused)}
        </div>
      );
    case "consumed":
      return (
        <div className="space-y-4">
          <p>This link has already been used for its one download, so it&apos;s finished. If you need anything else, contact the owner.</p>
          {state.canPause ? pauseSection(state.chargesPaused) : null}
        </div>
      );
    case "expired":
      return <p>The download window for this link has closed. If you still need the export, the owner can start again.</p>;
  }
}
