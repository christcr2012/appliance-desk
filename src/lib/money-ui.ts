/** Money is stored as integer cents, displayed in full dollars. */
const usd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Invalid money amount.");
  return usd.format(cents / 100).replace("-", "−");
}
export function moneyInputValue(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Invalid money amount.");
  return (cents / 100).toFixed(2);
}
/** Exact decimal conversion: no floating-point rounding of entered dollars. */
export function parseDollarInput(value: string, maxCents = Number.MAX_SAFE_INTEGER): number {
  const text = value.trim();
  if (!/^(0|[1-9]\d{0,12})(?:\.(\d{1,2}))?$/.test(text))
    throw new Error("Enter a dollar amount with up to two decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > maxCents)
    throw new Error("The dollar amount is outside the allowed range.");
  return cents;
}
/** Explicit boundary for existing dollar-valued form DTOs. */
export function centsAsDollars(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new Error("Invalid money amount.");
  return cents / 100;
}
