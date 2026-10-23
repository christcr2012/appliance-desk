import { requireSession } from "@/lib/session";
import { AccountShell } from "@/components/account-shell";
import { readCustomerLanguage } from "@/domains/language";
import { displayCustomerLanguage } from "@/domains/language/review";
import { IdleLogout } from "@/components/idle-logout";
import { getBusinessSettings } from "@/domains/settings";

const isReal = (value: string | null | undefined) => (value && !value.startsWith("[") ? value : null);

export const metadata = {
  robots: { index: false, follow: false },
};

// Any signed-in user can reach /account — customer data remains filtered by
// the signed-in user's id inside each page/domain query.
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const preference = await readCustomerLanguage(session.user.id);
  const language = await displayCustomerLanguage(preference);
  const settings = await getBusinessSettings();

  return (
    <AccountShell language={language} contact={{ phone: isReal(settings.publicPhone), email: isReal(settings.publicEmail) }}>
      {children}
      <IdleLogout timeoutMinutes={30} />
    </AccountShell>
  );
}
