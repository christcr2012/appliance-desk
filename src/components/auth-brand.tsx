import Image from "next/image";
import Link from "next/link";
import { getBusinessSettings } from "@/domains/settings";

/** The business name and mark above sign-in style pages, with a way back to the website. */
export async function AuthBrand() {
  const settings = await getBusinessSettings();
  const name = settings.publicBusinessName.startsWith("[") ? "Appliance rentals" : settings.publicBusinessName;
  return (
    <Link href="/" className="mb-8 flex min-h-11 items-center gap-3 self-start">
      <Image src="/brand/mark.svg" alt="" width={36} height={36} className="h-9 w-9" />
      <span className="text-lg font-semibold text-ink">{name}</span>
    </Link>
  );
}
