import Link from "next/link";
import { requireSession } from "@/lib/session";
import { deskMoreLinks } from "@/lib/desk-navigation";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "More" };

/** The rarely used desk screens (W-8). The list is filtered for the signed-in role here, on the server. */
export default async function MorePage() {
  const session = await requireSession();
  const links = deskMoreLinks(session.user.role);
  return (
    <div>
      <PageHeader title="More" description="Screens you don't need every day." />
      <Card title="Everything else">
        <ul className="divide-y divide-line">
          {links.map((link) => (
            <li key={link.href} className="py-3 first:pt-0 last:pb-0">
              <Link href={link.href} className="font-semibold text-action underline">{link.label}</Link>
              <p className="mt-1 text-sm text-ink-soft">{link.detail}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
