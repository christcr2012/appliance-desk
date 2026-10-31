/** RTC 'detail: full' stitches together the existing guarded MCP issue pages.
 * Each page is independently scoped and capped by the MCP handler. Never read
 * internal database tables or bypass the normal MCP authorization path.
 */
const MAX_FULL_BYTES = 480_000;
const MAX_PAGES = 32;
type Page = Record<string, unknown>;

export async function collectFullRtcIssues(
  args: Record<string, unknown>, readPage: (args: Record<string, unknown>) => Promise<Page>,
): Promise<Page> {
  const all: unknown[] = [];
  const seen = new Set<string>();
  let cursor = args.cursor as string | undefined;
  let lastCursor: string | null = null;
  let first: Page | null = null;
  let completed = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await readPage({ ...args, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page.issues) ||
        (page.nextCursor !== null && typeof page.nextCursor !== "string"))
      throw new Error("RTC_READ_PAGE_INVALID");
    if (!first) first = page;
    const combined = [...all, ...page.issues];
    const proposed = { ...first, issues: combined, nextCursor: page.nextCursor };
    if (Buffer.byteLength(JSON.stringify(proposed), "utf8") > MAX_FULL_BYTES) {
      if (all.length === 0) throw new Error("RTC_READ_PAGE_TOO_LARGE");
      break;
    }
    all.push(...page.issues);
    lastCursor = page.nextCursor;
    if (page.nextCursor === null) { completed = true; break; }
    if (!page.nextCursor || seen.has(page.nextCursor))
      throw new Error("RTC_READ_CURSOR_INVALID");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return {
    ...(first ?? {}),
    issues: all,
    nextCursor: completed ? null : lastCursor,
    truncated: !completed,
  };
}
