/** A plain download link to a CSV export route — a real <a href>, not a
 * button/action, so the browser just downloads the file the same way it
 * would any other link; no JS needed for this to work. */
export function ExportCsvLink({ href, label = "Export CSV" }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400"
    >
      {label}
    </a>
  );
}
