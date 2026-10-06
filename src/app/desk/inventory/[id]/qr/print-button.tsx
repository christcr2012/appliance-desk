"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="mt-3 rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action"
    >
      Print label
    </button>
  );
}
