import { StatusBadge, type StatusTone } from "@/components/status-badge";

export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return <StatusBadge tone={tone} label={label} variant="pill" />;
}
