import { AreaLayout } from "@/components/kit/area-layout";

export default function PaymentsLayout({ children }: { children: React.ReactNode }) {
  return <AreaLayout area="money">{children}</AreaLayout>;
}
