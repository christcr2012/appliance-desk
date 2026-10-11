import { formatMoney, moneyInputValue } from "@/lib/money-ui";

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={className}>{formatMoney(cents)}</span>;
}

export function MoneyInput({ name, id, cents, className, maxLength = 16 }: {
  name: string; id?: string; cents: number; className?: string; maxLength?: number;
}) {
  return <input type="text" inputMode="decimal" name={name} id={id}
    defaultValue={moneyInputValue(cents)} maxLength={maxLength}
    pattern="[0-9]+([.][0-9]{1,2})?" required className={className}
    aria-describedby={id ? `${id}-help` : undefined} />;
}
