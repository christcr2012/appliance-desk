"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  ButtonLink,
  Field,
  Select,
  StatusPill,
} from "@/components/ui";
import type { StatusTone } from "@/components/status-badge";
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

const STATE_TONE: Record<string, StatusTone> = {
  PENDING: "pending",
  SENDING: "progress",
  UNCERTAIN: "attention",
  FAILED: "attention",
  MISSED: "stopped",
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
  const needsFixing = ["MISSED", "UNCERTAIN", "FAILED"].includes(
    props.status,
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordNoticeDeliveryAction({
        noticeId: props.noticeId,
        channel: channel as
          | "MAIL"
          | "BUSINESS_MAILBOX"
          | "IN_PERSON_WRITTEN"
          | "TEXT_OR_APP",
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
    <li className="rounded-card border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            Renewal reminder for {props.customerName}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Created {props.createdLabel}. It goes to {props.customerEmail} once
            live customer email is turned on.
            {props.firstDayLabel && props.lastDayLabel && (
              <>
                {" "}
                It may be sent from {props.firstDayLabel} through{" "}
                {props.lastDayLabel}, and only in those days.
              </>
            )}
          </p>
        </div>
        <StatusPill
          tone={STATE_TONE[props.status] ?? "pending"}
          label={STATE_TEXT[props.status] ?? props.status}
        />
      </div>

      {props.lastError && (
        <p className="mt-2 text-sm text-ink-soft">{props.lastError}</p>
      )}

      {(props.deadline === "MISSED" || props.status === "MISSED") && (
        <div
          role="alert"
          className="mt-3 rounded-control border border-control bg-subtle px-3 py-3 text-sm text-danger"
        >
          <strong>Deadline missed.</strong> The last day to deliver this
          reminder has passed, so it will not be emailed and the automatic
          renewal cannot start by itself. Billing ends on the current end date.
          Delivering it late will <strong>not</strong> let the renewal start.
        </div>
      )}

      {props.deadline === "TOO_EARLY" && props.status === "PENDING" && (
        <p className="mt-3 rounded-control border border-line bg-subtle px-3 py-3 text-sm text-ink">
          Not due yet. It will be sent when it is inside the allowed days.
        </p>
      )}

      {props.status === "UNCERTAIN" && (
        <p
          role="status"
          className="mt-3 rounded-control border border-line bg-subtle px-3 py-3 text-sm text-ink"
        >
          The email service did not give a clear answer, so the email may
          already have gone out. We will not send it again by ourselves. Check
          your email provider&apos;s sent list, then say what you found.
        </p>
      )}

      {needsFixing && (
        <div className="mt-4">
          <ButtonLink
            href={`/desk/notices/${props.noticeId}/resolve`}
            variant="primary"
          >
            Fix this reminder
          </ButtonLink>
        </div>
      )}

      <div className="mt-5">
        <p className="text-sm font-semibold text-ink">{props.subject}</p>
        <pre className="mt-2 whitespace-pre-wrap rounded-control border border-line bg-subtle p-3 font-sans text-sm text-ink">
          {props.body}
        </pre>
      </div>

      {props.status !== "SENDING" && (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <h3 className="font-semibold text-ink">
              Already delivered it yourself?
            </h3>
            <p className="mt-1 text-xs text-ink-soft">
              Record how, when, and where. A phone call is not a delivery. If
              it was delivered inside the allowed days, the customer&apos;s
              renewal can start on its date. We save who recorded it and when,
              and it cannot be edited later.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id={`${id}-channel`}
              label="How"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
            >
              <option value="MAIL">Mailed (a printed copy by mail)</option>
              <option value="BUSINESS_MAILBOX">
                Emailed from our own business mailbox
              </option>
              <option value="IN_PERSON_WRITTEN">
                Printed copy handed over
              </option>
              <option value="TEXT_OR_APP">
                Text message (customer agreed to texts)
              </option>
            </Select>

            <Field
              id={`${id}-date`}
              label="Date"
              type="date"
              value={date}
              max={businessDateKey(new Date())}
              onChange={(event) => setDate(event.target.value)}
            />

            <Field
              id={`${id}-to`}
              label="Address, email or number used"
              value={sentTo}
              onChange={(event) => setSentTo(event.target.value)}
              maxLength={200}
            />

            <Field
              id={`${id}-note`}
              label="Note: how you know it arrived"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
            />
          </div>

          <Button
            type="submit"
            disabled={
              pending ||
              sentTo.trim().length < 2 ||
              note.trim().length < 2
            }
          >
            {pending ? "Saving…" : "Record delivery"}
          </Button>

          {error && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
