export function DraftNotice() {
  return (
    <div className="rounded-xl bg-warning-bg px-5 py-4 text-sm text-warning-ink">
      <strong className="font-semibold">Draft — pending legal review.</strong>{" "}
      This page is a good-faith starting point, not final legal advice. It
      will be reviewed by a lawyer before launch (see the launch checklist in
      this project&apos;s internal handoff notes).
    </div>
  );
}
