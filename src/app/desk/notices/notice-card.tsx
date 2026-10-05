"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordNoticeDeliveryAction } from "./actions";
import { businessDateKey } from "@/lib/business-date";

export type NoticeCardProps = {
  noticeId: string;
  status: string;
  customerName: string;
  customerEmail: string;
  createdLabel: string;
  subject: string;
  body: string;
  deadline?: "OK" | "MISSED" | "TOO_EARLY" | "UNKNOWN";
  firstDayLabel?: string | null;
  lastDayLabel?: string | null;
  lastError?: string | null;
};

const STATE_TEXT: Record<string, string> = {
  PENDING: "Waiting to be emailed",
  SENDING: "Being sent right now",
  UNCERTAIN: "May or may not have gone out",
  FAILED: "Refused three times",
  MISSED: "Missed: its last day passed",
};

export function NoticeCard(props: NoticeCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [channel, setChannel] = useState("MAIL");
  const [sentTo, setSentTo] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => businessDateKey(new Date()));
  const [error, setError] = useState<string | null>(null);
  const id = `notice-${props.noticeId}`;
  const needsFixing = ["MISSED", "UNCERTAIN", "FAILED"].includes(props.status);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordNoticeDeliveryAction({
        noticeId: props.noticeId,
        channel: channel as "MAIL" | "BUSINESS_MAILBOX" | "IN_PERSON_WRITTEN" | "TEXT_OR_APP",
        date,
        sentTo,
        note,
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">Renewal reminder for {props.customerName}</h2>
      <p className="mt-1 text-sm text-gray-700">
        <strong>{STATE_TEXT[props.status] ?? props.status}.</strong> Created {props.createdLabel}. It goes to{" "}
        {props.customerEmail} once live customer email is turned on.
        {props.firstDayLabel && props.lastDayLabel && (
          <> It may be sent from {props.firstDayLabel} through {props.lastDayLabel}, and only in those days.</>
        )}
      </p>
      {props.lastError && <p className="mt-1 text-sm text-gray-700">{props.lastError}</p>}
      {(props.deadline === "MISSED" || props.status === "MISSED") && (
        <p role="alert" className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <strong>Deadline missed.</strong> The last day to deliver this reminder has passed, so it will not be emailed
          and the automatic renewal cannot start by itself. Billing ends on the current end date. Delivering it late will{" "}
          <strong>not</strong> let the renewal start.
        </p>
      )}
      {props.deadline === "TOO_EARLY" && props.status === "PENDING" && (
        <p className="mt-2 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900">
          Not due yet. It will be sent when it is inside the allowed days.
        </p>
      )}
      {props.status === "UNCERTAIN" && (
        <p role="status" className="mt-2 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900">
          The email service did not give a clear answer, so the email may already have gone out. We will not send it
          again by ourselves. Check your email provider&rsquo;s sent list, then say what you found.
        </p>
      )}
      {needsFixing && (
        <p className="mt-3">
          <Link
            href={`/desk/notices/${props.noticeId}/resolve`}
            className="inline-block rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white"
          >
            Fix this reminder
          </Link>
        </p>
      )}
      <p className="mt-3 text-sm font-medium text-gray-900">{props.subject}</p>
      <pre className="mt-1 whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 font-sans text-sm text-gray-800">
        {props.body}
      </pre>
      {props.status !== "SENDING" && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <p className="text-sm font-medium text-gray-900">Already delivered it yourself?</p>
          <p className="text-xs text-gray-600">
            Record how, when and where. A phone call is not a delivery. If it was delivered inside the allowed days the
            customer&rsquo;s renewal can start on its date. We save who recorded it and when, and it can&rsquo;t be edited later.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={`${id}-channel`} className="block text-sm text-gray-900">How</label>
              <select id={`${id}-channel`} value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="MAIL">Mailed (a printed copy by mail)</option>
                <option value="BUSINESS_MAILBOX">Emailed from our own business mailbox</option>
                <option value="IN_PERSON_WRITTEN">Printed copy handed over</option>
                <option value="TEXT_OR_APP">Text message (customer agreed to texts)</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-date`} className="block text-sm text-gray-900">Date</label>
              <input id={`${id}-date`} type="date" value={date} max={businessDateKey(new Date())} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor={`${id}-to`} className="block text-sm text-gray-900">Address, email or number used</label>
              <input id={`${id}-to`} value={sentTo} onChange={(e) => setSentTo(e.target.value)} maxLength={200} className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor={`${id}-note`} className="block text-sm text-gray-900">Note: how you know it arrived</label>
              <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <button
              type="submit"
              disabled={pending || sentTo.trim().length < 2 || note.trim().length < 2}
              className="rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Saving…" : "Record delivery"}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-800">
              {error}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
