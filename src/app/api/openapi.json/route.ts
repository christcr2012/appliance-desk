import { rtcJson } from "@/mcp/rtc-adapter";
export const dynamic = "force-dynamic";
export function GET() {
  return rtcJson({ openapi: "3.1.0", info: {
    title: "Appliance Desk RTC 1 (read-only)", version: "1.0.0" },
    paths: {
      "/api/contract": { get: { summary: "Public RTC manifest" } },
      "/api/tools": { get: { summary: "Search available read tools" } },
      "/api/tools/{name}": { get: { summary: "Describe an authorized read tool" },
        post: { summary: "Call an authorized read tool" } },
      "/api/tools/_batch": { post: { summary: "Call up to ten read tools" } },
      "/api/results/{handle}": { get: { summary: "Read an owned, unexpired result" } },
      "/api/whoami": { get: { summary: "Current RTC pass identity" } },
    },
  });
}
