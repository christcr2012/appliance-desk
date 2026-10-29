import { AreaLayout } from "@/components/kit/area-layout";
import { prisma } from "@/lib/prisma";
import { BooksTabs } from "./books-tabs";

// AR-7: every Books page renders inside the Money area with the Books sub-tab strip on top.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { cashBudgetEnabled: true },
  });
  return (
    <AreaLayout area="money">
      <div className="space-y-5">
        <BooksTabs budgetsOn={settings?.cashBudgetEnabled ?? false} />
        {children}
      </div>
    </AreaLayout>
  );
}
