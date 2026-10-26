import { TaxActionForm } from "../setup/forms";
import { saveTimingSettingsFormAction } from "./actions";

/** Owner timing for changes that cost the business (TAX-FEE-AUTOPILOT section 3). */
export function TimingSection({ percent, marginBusinessDays }: {
  percent: number;
  marginBusinessDays: number;
}) {
  return (
    <TaxActionForm action={saveTimingSettingsFormAction} title="When to act on changes that cost you" submitLabel="Save timing">
      <input type="hidden" name="expectedPercent" value={percent} />
      <input type="hidden" name="expectedMarginBusinessDays" value={marginBusinessDays} />
      <p className="text-sm text-muted-foreground">
        For things that cost you money or don&rsquo;t help you to do early &mdash; paying a return, filing 1099s,
        renewing a license &mdash; the app suggests a day this far through the time allowed.
        Starting value 90%, your choice on Oct 25, 2026.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">
          How far through the time allowed (%)
          <input name="percent" type="number" min={85} max={95} step={1} defaultValue={percent} required
            className="w-full rounded border border-input bg-background p-2 text-sm" />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Safety margin (business days before the deadline)
          <input name="marginBusinessDays" type="number" min={1} max={10} step={1} defaultValue={marginBusinessDays} required
            className="w-full rounded border border-input bg-background p-2 text-sm" />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        Always at least this many business days before the deadline, so a slow bank day can&rsquo;t make it late.
        Starting value 3.
      </p>
      <button name="operation" value="restore" type="submit" formNoValidate
        className="rounded-lg border border-border px-4 py-2 text-sm font-medium">
        Restore recommended (90% and 3 days)
      </button>
    </TaxActionForm>
  );
}
