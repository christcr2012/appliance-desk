import { requireSession } from "@/lib/session";
import { AccountShell } from "@/components/account-shell";
import { IdleLogout } from "@/components/idle-logout";

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
  await requireSession();

  return (
    <AccountShell>
      {children}
      <IdleLogout timeoutMinutes={30} />
    </AccountShell>
  );
}
