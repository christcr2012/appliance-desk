import { hoursLines, upcomingClosures } from "@/domains/settings/profile-extras";

/** Opening hours and upcoming holiday closures. Renders nothing until the owner has set something. */
export function BusinessHours({
  hours,
  holidayClosures,
  headingLevel: Heading = "h2",
  className = "",
}: {
  hours: unknown;
  holidayClosures: unknown;
  headingLevel?: "h2" | "h3";
  className?: string;
}) {
  const lines = hoursLines(hours);
  const closures = upcomingClosures(holidayClosures);
  if (lines.length === 0 && closures.length === 0) return null;
  return (
    <div className={className}>
      {lines.length > 0 && (
        <>
          <Heading className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Hours (Colorado time)</Heading>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {closures.length > 0 && (
        <>
          <Heading className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-faint">Upcoming closures</Heading>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            {closures.slice(0, 6).map((c) => (
              <li key={c.date}>{c.text}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
