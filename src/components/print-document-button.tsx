"use client";

/** Triggers the browser's own print dialog — same "just use the browser"
 * approach as ExportCsvLink's plain <a href>, no PDF-generation library
 * needed. Shared by every printable business document (invoices, and
 * now work orders — see src/components/billing/invoice-document.tsx and
 * src/components/jobs/work-order-document.tsx). Each document has its
 * own print-specific CSS (the `print:` classes on the document itself)
 * so the page's nav, back link, and this button all disappear on the
 * printed/saved-as-PDF output and only the document remains. */
export function PrintDocumentButton({ label = "Print / save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400 print:hidden"
    >
      {label}
    </button>
  );
}
