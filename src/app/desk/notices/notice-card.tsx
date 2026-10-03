"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNoticeDeliveredAction } from "./actions";
import { businessDateKey } from "@/lib/business-date";

export type NoticeCardProps = {
  noticeId: string;
  customerName: string;
  customerEmail: string;
  createdLabel: string;
  subject: string;
  body: string;
  possiblySent?: boolean;
};

export function NoticeCard(props: NoticeCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [how, setHow] = useState("");
  const [deliveredOn, setDeliveredOn] = useState(() => businessDateKey(new Date()));
  const [error, setError] = useState<string | null>(null);
  const inputId = `notice-how-${props.noticeId}`;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await markNoticeDeliveredAction({ noticeId: props.noticeId, how, deliveredOn });
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
        Created {props.createdLabel}. It goes to {props.customerEmail} once live customer email is turned on.
      </p>
      {props.possiblySent && (
        <p role="status" className="mt-2 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900">
          The email may already have gone out: the send was interrupted before we could record it. We will not send it again
          by ourselves. Check your email provider&rsquo;s sent list (or ask the customer), then mark it as delivered below with
          the real date.
        </p>
      )}
      <p className="mt-3 text-sm font-medium text-gray-900">{props.subject}</p>
      <pre className="mt-1 whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 font-sans text-sm text-gray-800">
        {props.body}
      </pre>
      <form onSubmit={submit} className="mt-4">
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-900">
          Already delivered it yourself? How?
        </label>
        <p className="mt-1 text-xs text-gray-600">
          For example “phoned”, “mailed” or “in person”. The date defaults to today; change it if you delivered it earlier. We save who marked it and when, then the customer&rsquo;s
          renewal can start on its date.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            id={inputId}
            value={how}
            onChange={(e) => setHow(e.target.value)}
            maxLength={80}
            className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <label htmlFor={`${inputId}-date`} className="text-sm text-gray-900">
            Date delivered
          </label>
          <input
            id={`${inputId}-date`}
            type="date"
            value={deliveredOn}
            max={businessDateKey(new Date())}
            onChange={(e) => setDeliveredOn(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={pending || how.trim().length < 2}
            className="rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Mark as delivered"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </form>
    </li>
  );
}
