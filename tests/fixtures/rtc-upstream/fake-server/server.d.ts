/** Local TypeScript binding only; the upstream .js fake server is unchanged. */
export type FakeRtcServer = {
  url: string;
  passes: Record<string, string>;
  oauth: unknown;
  state: { value: string };
  close: () => Promise<void>;
};
export function startFakeServer(options?: {
  prefix?: string;
  faults?: string[];
  passes?: Record<string, string>;
  rateLimit?: unknown;
}): Promise<FakeRtcServer>;
