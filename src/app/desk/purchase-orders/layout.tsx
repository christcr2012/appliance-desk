import { AreaLayout } from "@/components/kit/area-layout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AreaLayout area="equipment">{children}</AreaLayout>;
}
