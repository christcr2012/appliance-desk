import { TaxActionForm } from "../setup/forms";
import { saveWatchSettingsFormAction } from "./actions";

/** Owner switch for the official-page watches (TAX-FEE-AUTOPILOT section 12). */
export function WatchSection({ enabled }: { enabled: boolean }) {
  return (
    <TaxActionForm action={saveWatchSettingsFormAction} title="Watch the official tax pages" submitLabel="Save watch setting">
      <input type="hidden" name="expectedEnabled" value={enabled ? "on" : "off"} />
      <p className="text-sm text-muted-foreground">
        When this is on, the app reads the official Colorado, IRS and Greeley tax pages every week, and every
        day in the weeks when a new amount is expected. When a page states a new tax or fee amount, the reading
        waits on your To do list — nothing is ever changed until you approve it there.
        Starting value on. Only you can change this.
      </p>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input name="watchOfficialTaxPages" type="checkbox" value="on" defaultChecked={enabled}
          className="h-4 w-4 rounded border-input" />
        Watch for new tax and fee amounts
      </label>
    </TaxActionForm>
  );
}
