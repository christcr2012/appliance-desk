"use client";

export function TryAgain() {
  return (
    <button type="button" onClick={() => window.location.reload()}
      className="min-h-11 rounded-field bg-primary px-5 py-3 font-bold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2">
      Try again
    </button>
  );
}
