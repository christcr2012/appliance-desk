"use client";

import { Button } from "@/components/ui/button";

/** Triggers the browser's own print dialog — same "just use the browser"
 * approach as ExportCsvLink's plain <a href>, no PDF-generation library
 * needed. Shared by every printable business document (invoices and work
 * orders). Each document keeps its own print-specific treatment while the
 * application shells and this button disappear from printed/saved-as-PDF
 * output. */
export function PrintDocumentButton({
  label = "Print / save as PDF",
}: {
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => window.print()}
      className="print:hidden"
    >
      {label}
    </Button>
  );
}
