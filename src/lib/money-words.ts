const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    const t = TENS[Math.floor(n / 10)];
    parts.push(n % 10 ? `${t}-${ONES[n % 10]}` : t);
  } else if (n > 0 || parts.length === 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

const SCALES: Array<[number, string]> = [
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
];

function wholeNumber(n: number): string {
  for (const [size, name] of SCALES) {
    if (n >= size) {
      const head = `${wholeNumber(Math.floor(n / size))} ${name}`;
      const rest = n % size;
      return rest ? `${head} ${wholeNumber(rest)}` : head;
    }
  }
  return under1000(n);
}

/** 4550 → "forty-five dollars and fifty cents". Used so a confirmation repeats an amount in words. Pure. */
export function centsInWords(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) return "";
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  const d = `${wholeNumber(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  return rest === 0 ? d : `${d} and ${wholeNumber(rest)} ${rest === 1 ? "cent" : "cents"}`;
}
