"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmEmailOutcomeAction, recordNoticeDeliveryAction, resolveMissedNoticeAction } from "../../actions";
import { businessDateKey } from "@/lib/business-date";

type Option = { kind: string; available: boolean; why: string; effect: string };

const TITLES: Record<string, string> = {
  CANCEL_AUTOMATIC_RENEWAL: "Cancel the automatic renewal",
  SEND_NEW_RENEWAL: "Send the customer a new renewal to sign",
  MOVE_RENEWAL_LATER: "Move the renewal later",
  RECORD_DELIVERY: "I delivered it another way",
  CONFIRM_EMAIL: "Check whether the email went out",
  KEEP_WAITING: "Keep it waiting",
  ACKNOWLEDGE: "Leave it; billing carries on",
  END_RENTAL: "End the rental now",
};

export function ResolveForm({
  noticeId,
  expectedUpdatedAt,
  noticeStatus,
  options,
}: {
  noticeId: string;
  expectedUpdatedAt: string;
  noticeStatus: string;
  options: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const first = options.find((o) => o.available)?.kind ?? "";
  const [kind, setKind] = useState(first);
  const [note, setNote] = useState("");
  const [schedulePickup, setSchedulePickup] = useState(true);
  const [termMonths, setTermMonths] = useState("");
  const today = businessDateKey(new Date());
  const [remindOn, setRemindOn] = useState(today);
  const [channel, setChannel] = useState("MAIL");
  const [date, setDate] = useState(today);
  const [sentTo, setSentTo] = useState("");
  const [emailWent, setEmailWent] = useState("yes");
  const [error, setError] = useState<string | null>(null);

  function go(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      let result;
      if (kind === "RECORD_DELIVERY") {
        result = await recordNoticeDeliveryAction({
          noticeId,
          channel: channel as "MAIL" | "BUSINESS_MAILBOX" | "IN_PERSON_WRITTEN" | "TEXT_OR_APP",
          date,
          sentTo,
          note,
        });
      } else if (kind === "CONFIRM_EMAIL") {
        result = await confirmEmailOutcomeAction({
          noticeId,
          answer: emailWent === "yes" ? { sent: true, acceptedOn: date } : { sent: false },
        });
      } else {
        const choice =
          kind === "CANCEL_AUTOMATIC_RENEWAL"
            ? ({ kind, schedulePickup } as const)
            : kind === "SEND_NEW_RENEWAL"
              ? ({ kind, termMonths: termMonths === "" ? null : (Number(termMonths) as 6 | 12) } as const)
              : kind === "KEEP_WAITING"
                ? ({ kind, remindOn } as const)
                : ({ kind } as { kind: "MOVE_RENEWAL_LATER" | "END_RENTAL" | "ACKNOWLEDGE" });
        result = await resolveMissedNoticeAction({ noticeId, expectedUpdatedAt, choice, note });
      }
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      router.push(("redirectTo" in result && result.redirectTo) || "/desk/notices");
      router.refresh();
    });
  }

  const needsNote = kind !== "CONFIRM_EMAIL";
  return (
    <form onSubmit={go} className="max-w-3xl space-y-4">
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-gray-900">What do you want to do? ({noticeStatus.toLowerCase()})</legend>
        {options.map((o) => (
          <div key={o.kind} className={`rounded-lg border p-4 ${o.available ? "border-gray-300 bg-white" : "border-gray-200 bg-gray-50"}`}>
            <label className="flex items-start gap-3 text-sm text-gray-900">
              <input
                type="radio"
                name="option"
                value={o.kind}
                disabled={!o.available}
                checked={kind === o.kind}
                onChange={() => setKind(o.kind)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{TITLES[o.kind] ?? o.kind}</span>
                <span className="mt-1 block text-gray-700">{o.effect}</span>
                <span className="mt-1 block text-xs text-gray-600">{o.available ? "Available." : "Not available:"} {o.why}</span>
              </span>
            </label>
            {kind === o.kind && o.available && (
              <div className="mt-3 space-y-3 pl-7 text-sm">
                {o.kind === "CANCEL_AUTOMATIC_RENEWAL" && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={schedulePickup} onChange={(e) => setSchedulePickup(e.target.checked)} />
                    Also create the pickup visit for the day after the term ends
                  </label>
                )}
                {o.kind === "SEND_NEW_RENEWAL" && (
                  <div>
                    <label htmlFor="renewal-term" className="block font-medium">Length of the new renewal</label>
                    <select id="renewal-term" value={termMonths} onChange={(e) => setTermMonths(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2">
                      <option value="">Month to month</option>
                      <option value="6">6 months</option>
                      <option value="12">12 months</option>
                    </select>
                  </div>
                )}
                {o.kind === "KEEP_WAITING" && (
                  <div>
                    <label htmlFor="remind-on" className="block font-medium">Remind me on</label>
                    <input id="remind-on" type="date" min={today} value={remindOn} onChange={(e) => setRemindOn(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2" />
                  </div>
                )}
                {o.kind === "RECORD_DELIVERY" && (
                  <div className="flex flex-wrap gap-3">
                    <div>
                      <label htmlFor="del-channel" className="block font-medium">How</label>
                      <select id="del-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2">
                        <option value="MAIL">Mailed</option>
                        <option value="BUSINESS_MAILBOX">Emailed from our business mailbox</option>
                        <option value="IN_PERSON_WRITTEN">Printed copy handed over</option>
                        <option value="TEXT_OR_APP">Text message (customer agreed to texts)</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="del-date" className="block font-medium">Date</label>
                      <input id="del-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2" />
                    </div>
                    <div>
                      <label htmlFor="del-to" className="block font-medium">Address, email or number used</label>
                      <input id="del-to" value={sentTo} onChange={(e) => setSentTo(e.target.value)} maxLength={200} className="w-64 rounded-lg border border-gray-300 px-3 py-2" />
                    </div>
                  </div>
                )}
                {o.kind === "CONFIRM_EMAIL" && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2"><input type="radio" name="went" checked={emailWent === "yes"} onChange={() => setEmailWent("yes")} /> It went out</label>
                    <label className="flex items-center gap-2"><input type="radio" name="went" checked={emailWent === "no"} onChange={() => setEmailWent("no")} /> It did not go out</label>
                    {emailWent === "yes" && (
                      <div>
                        <label htmlFor="email-date" className="block font-medium">Date the email service shows</label>
                        <input id="email-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </fieldset>
      {needsNote && (
        <div>
          <label htmlFor="resolve-note" className="block text-sm font-medium text-gray-900">Note (saved with the record: why, or how you know)</label>
          <input id="resolve-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full max-w-xl rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <button type="submit" disabled={pending || !kind} className="rounded-full bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Working…" : "Do this"}
      </button>
    </form>
  );
}
