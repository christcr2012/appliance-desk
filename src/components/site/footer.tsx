import Link from "next/link";
import Image from "next/image";
import { Container } from "./container";
import { publicNavLinks } from "./nav-links";
import { BusinessHours } from "./business-hours";
import { socialLinkList } from "@/domains/settings/profile-extras";

export function Footer({
  businessName,
  phone,
  email,
  address,
  hours,
  holidayClosures,
  socialLinks,
  privacyApproved = false,
  termsApproved = false,
  prelaunch = false,
}: {
  businessName: string;
  phone: string;
  email: string;
  address: string;
  hours?: unknown;
  holidayClosures?: unknown;
  socialLinks?: unknown;
  privacyApproved?: boolean;
  termsApproved?: boolean;
  prelaunch?: boolean;
}) {
  const social = socialLinkList(socialLinks);
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-canvas-alt">
      <Container className="grid gap-10 py-14 md:grid-cols-3">
        <div>
          <Image
            src="/brand/logo-light.svg"
            alt={businessName}
            width={169}
            height={40}
            className="h-8 w-auto dark:hidden"
          />
          <Image
            src="/brand/logo-dark.svg"
            alt={businessName}
            width={169}
            height={40}
            className="hidden h-8 w-auto dark:block"
          />
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
            {publicNavLinks(prelaunch).map((link) => (
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
          <BusinessHours hours={hours} holidayClosures={holidayClosures} className="mt-4" />
          {social.length > 0 && (
            <ul aria-label="Find us online" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {social.map((l) => (
                <li key={l.id}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-ink-soft underline hover:text-primary">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Container>

      <div className="border-t border-line">
        <Container className="flex flex-col gap-2 py-6 text-xs text-ink-faint md:flex-row md:items-center md:justify-between">
          <p>
            &copy; {year} {businessName}. All rights reserved.
          </p>
          <nav aria-label="Legal" className="flex gap-4">
            {privacyApproved && (
              <Link href="/privacy" className="hover:text-primary">
                Privacy Policy
              </Link>
            )}
            {termsApproved && (
              <Link href="/terms" className="hover:text-primary">
                Terms
              </Link>
            )}
            <Link href="/accessibility" className="hover:text-primary">
              Accessibility
            </Link>
          </nav>
        </Container>
      </div>
    </footer>
  );
}
