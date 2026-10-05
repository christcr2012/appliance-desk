import { endMonthToMonthForCustomerAction } from "../actions";
import { formatBusinessDate } from "@/lib/business-date";

/** Owner/admin: end a month-to-month rental on the customer's behalf. No fee. */
export function MonthToMonthEndForm(props: {
  agreementId: string;
  noticeDays: number;
  effectiveOn: Date;
  earlierOptions: Date[];
}) {
  return (
    <form action={endMonthToMonthForCustomerAction} className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium text-gray-900">End this month-to-month rental</h2>
      <p className="mt-1 text-sm text-gray-700">
        There is no fee. With {props.noticeDays} days&apos; notice the rental ends on {formatBusinessDate(props.effectiveOn)}, the
        next billing date after that. The nightly job ends it on that day and billing stops with it.
      </p>
      <input type="hidden" name="agreementId" value={props.agreementId} />
      {props.earlierOptions.length > 0 && (
        <div className="mt-3">
          <label htmlFor="earlierEffectiveOn" className="block text-sm font-medium text-gray-900">
            End earlier (optional)
          </label>
          <select id="earlierEffectiveOn" name="earlierEffectiveOn" defaultValue="" className="mt-1 min-h-11 rounded-lg border border-control px-3">
            <option value="">No, use {formatBusinessDate(props.effectiveOn)}</option>
            {props.earlierOptions.map((d) => (
              <option key={d.toISOString()} value={d.toISOString()}>
                {formatBusinessDate(d)}
              </option>
            ))}
          </select>
          <label htmlFor="reason" className="mt-3 block text-sm font-medium text-gray-900">
            Reason for ending earlier (required if you pick a date above)
          </label>
          <input id="reason" name="reason" maxLength={500} className="mt-1 min-h-11 w-full rounded-lg border border-control px-3" />
        </div>
      )}
      <button type="submit" className="mt-4 min-h-11 rounded-lg border border-control px-4 py-2 text-sm text-primary hover:bg-subtle">
        End rental
      </button>
    </form>
  );
}
