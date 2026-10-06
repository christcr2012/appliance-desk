import Link from "next/link";
import type { JobStatus, JobType } from "@prisma/client";
import {
  CalendarServiceIcon,
  DeliveryServiceIcon,
  SupportServiceIcon,
} from "@/components/icons/service-icons";
import { StatusPill } from "@/components/ui/status-pill";
import {
  jobStatusLabel,
  jobStatusTone,
  jobTypeLabel,
} from "@/lib/status-labels";

function JobTypeIcon({
  type,
  className = "",
}: {
  type: JobType;
  className?: string;
}) {
  if (type === "DELIVERY" || type === "INSTALLATION") {
    return <DeliveryServiceIcon className={className} />;
  }
  if (type === "MAINTENANCE_VISIT" || type === "SWAP") {
    return <SupportServiceIcon className={className} />;
  }
  return <CalendarServiceIcon className={className} />;
}

export function VisitRow({
  time,
  customer,
  address,
  type,
  status,
  href,
}: {
  time: string;
  customer: string;
  address: string;
  type: JobType;
  status: JobStatus;
  href: string;
}) {
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        href={href}
        className="grid min-h-16 gap-2 py-4 text-ink hover:bg-subtle sm:grid-cols-[5rem_1fr_auto]"
      >
        <time className="font-semibold tabular-nums">{time}</time>
        <div className="min-w-0">
          <p className="font-semibold">{customer}</p>
          <p className="mt-1 text-sm text-ink-soft">{address}</p>
          <p className="mt-2 inline-flex items-center gap-2 text-sm text-ink-soft">
            <JobTypeIcon type={type} className="h-5 w-5 shrink-0" />
            {jobTypeLabel(type)}
          </p>
        </div>
        <div className="sm:justify-self-end">
          <StatusPill
            tone={jobStatusTone(status)}
            label={jobStatusLabel(status)}
          />
        </div>
      </Link>
    </li>
  );
}
