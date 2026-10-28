/** Splits a long line at word breaks (keeping its indent) so a printed line never loses its tail. */
export function wrapLine(text: string, max: number): string[] {
  const indent = /^\s*/.exec(text)?.[0] ?? "";
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(" ", max);
    const at = cut > indent.length ? cut : max;
    out.push(rest.slice(0, at));
    rest = indent + rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}
