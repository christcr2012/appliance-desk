"use client";

/** Triggers the browser's own print dialog — same "just use the
 * browser" approach as ExportCsvLink's plain <a href>, no PDF-generation
 * library needed. The invoice document itself has print-specific CSS
 * (see the `print:` classes in invoice-document.tsx) so the page's nav,
 * back link, and this button all disappear on the printed/saved-as-PDF
 * output and only the document itself remains. */
export function PrintInvoiceButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400 print:hidden"
    >
      Print / save as PDF
    </button>
  );
}
