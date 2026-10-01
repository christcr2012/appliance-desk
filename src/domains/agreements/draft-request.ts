import { createHash } from "node:crypto";
export function draftRequestId(actorId: string, requestKey: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestKey,
    )
  )
    throw new Error("Invalid draft save request. Reload the builder.");
  return `draft_${createHash("sha256")
    .update(JSON.stringify([actorId, requestKey.toLowerCase()]))
    .digest("hex")}`;
}
