"use client";
// AR-7 (BOOKS-TAXES 1.3): the Reports view switcher — SegmentedControl on desktop, the kit
// Select in a GET form on phone. Changing the view keeps the rest of the query string.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl, Select } from "@/components/kit";

export const REPORT_VIEWS = [
  { value: "profit", label: "Profit" },
  { value: "own-owe", label: "Own & owe" },
  { value: "payback", label: "Payback" },
  { value: "cash-and-customers", label: "Cash & customers" },
];

export function ReportsViewSwitch({ view }: { view: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const go = (value: string) => {
    const params = new URLSearchParams(search?.toString() ?? "");
    params.set("view", value);
    params.delete("kind");
    router.push(`${pathname}?${params.toString()}`);
  };
  return (
    <>
      <div className="hidden sm:block">
        <SegmentedControl name="view" label="Report view" options={REPORT_VIEWS} value={view} onChange={go} />
      </div>
      <form method="GET" className="flex items-end gap-2 sm:hidden">
        <div className="min-w-0 flex-1">
          <Select name="view" label="Report view" options={REPORT_VIEWS} value={view} />
        </div>
        <button type="submit" className="min-h-11 rounded-field border border-line px-3 font-bold">View</button>
      </form>
    </>
  );
}
