import { Container } from "./container";

/**
 * V-3: the bold opening shared by the inner public pages. A full-width evergreen band (the dark surface in dark mode)
 * with the page's one h1 at the display size. It only lays out words the page already reads from the website content,
 * so every word stays editable; it adds no marketing words of its own.
 */
export function PageHero({
  heading,
  lede,
  eyebrow,
}: {
  heading: React.ReactNode;
  lede?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <section className="bg-canvas">
      <Container className="pt-6 md:pt-10">
        <div className="cut-band bg-primary px-6 py-14 text-on-primary dark:bg-surface dark:text-ink md:px-14 md:py-20">
          {eyebrow ? <p className="text-eyebrow uppercase opacity-90">{eyebrow}</p> : null}
          <h1 className={`text-display ${eyebrow ? "mt-4" : ""} max-w-4xl`}>{heading}</h1>
          {lede ? <p className="mt-6 max-w-2xl text-lede opacity-90">{lede}</p> : null}
        </div>
      </Container>
    </section>
  );
}
