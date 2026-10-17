import { SectionTabs } from "@/components/desk/section-tabs";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionTabs section="equipment" />
      {children}
    </>
  );
}
