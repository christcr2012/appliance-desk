import Link from "next/link";
import { Container } from "./container";
import { NAV_LINKS } from "./nav-links";

export function Footer({
  businessName,
  phone,
  email,
  address,
}: {
  businessName: string;
  phone: string;
  email: string;
  address: string;
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-canvas-alt">
      <Container className="grid gap-10 py-14 md:grid-cols-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            {businessName}
          </p>
          <p className="mt-3 max-w-xs text-sm text-ink-soft">
            Straightforward appliance rentals for Colorado homes and
            properties — delivered, installed, and serviced by a real local
            business.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Explore
          </h2>
          <ul className="mt-4 space-y-2">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-ink-soft hover:text-primary"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Contact
          </h2>
          <ul className="mt-4 space-y-2 text-sm text-ink-soft">
            <li>
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="hover:text-primary">
                {phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${email}`} className="hover:text-primary">
                {email}
              </a>
            </li>
            <li>{address}</li>
          </ul>
        </div>
      </Container>

      <div className="border-t border-line">
        <Container className="flex flex-col gap-2 py-6 text-xs text-ink-faint md:flex-row md:items-center md:justify-between">
          <p>
            &copy; {year} {businessName}. All rights reserved.
          </p>
          <nav aria-label="Legal" className="flex gap-4">
            <Link href="/privacy" className="hover:text-primary">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-primary">
              Terms
            </Link>
            <Link href="/accessibility" className="hover:text-primary">
              Accessibility
            </Link>
          </nav>
        </Container>
      </div>
    </footer>
  );
}
