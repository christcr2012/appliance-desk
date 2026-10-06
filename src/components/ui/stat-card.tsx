import Link from "next/link";

function Content({
  label,
  value,
  detail,
  headline,
}: {
  label: string;
  value: string;
  detail?: string;
  headline: boolean;
}) {
  return (
    <>
      <span className={`block text-sm font-semibold ${headline ? "text-nav-ink" : "text-ink-soft"}`}>
        {label}
      </span>
      <span className={`mt-2 block text-3xl font-semibold tabular-nums ${headline ? "text-nav-ink" : "text-ink"}`}>
        {value}
      </span>
      {detail && (
        <span className={`mt-2 block text-sm ${headline ? "text-nav-ink" : "text-ink-soft"}`}>
          {detail}
        </span>
      )}
    </>
  );
}

export function StatCard({
  label,
  value,
  detail,
  href,
  tone = "plain",
}: {
  label: string;
  value: string;
  detail?: string;
  href?: string;
  tone?: "headline" | "plain";
}) {
  const headline = tone === "headline";
  const className = `block min-w-0 rounded-card border p-5 ${
    headline
      ? "stat-card-headline border-nav-bg"
      : "border-line bg-surface hover:bg-subtle"
  }`;
  const content = <Content label={label} value={value} detail={detail} headline={headline} />;
  return href ? <Link href={href} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}
