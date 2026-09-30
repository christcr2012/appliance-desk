import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { verifySchemaHealth } from "@/lib/schema-health";

// Use the schema independently of the helper's generated model-name source.
const models = [...readFileSync("prisma/schema.prisma", "utf8").matchAll(/^model (\w+) \{/gm)]
  .map((match) => match[1]!);

function makeClient() {
  return Object.fromEntries(models.map((model) => [
    model[0]!.toLowerCase() + model.slice(1),
    { findFirst: vi.fn().mockResolvedValue(null) },
  ]));
}

describe("verifySchemaHealth", () => {
  it("checks every schema model even when all tables are empty", async () => {
    const client = makeClient();
    await verifySchemaHealth(client as unknown as Parameters<typeof verifySchemaHealth>[0]);
    for (const delegate of Object.values(client)) {
      expect(delegate.findFirst).toHaveBeenCalledExactlyOnceWith();
    }
  });

  it.each(["estimateLineItem", "purchaseOrderLineItem", "staffTask", "account"])(
    "stops and names the affected model when %s cannot be queried",
    async (delegate) => {
      const client = makeClient();
      const cause = new Error("column does not exist");
      client[delegate]!.findFirst.mockRejectedValue(cause);
      const model = delegate[0]!.toUpperCase() + delegate.slice(1);
      await expect(verifySchemaHealth(client as unknown as Parameters<typeof verifySchemaHealth>[0]))
        .rejects.toMatchObject({ message: expect.stringContaining(model), cause });
      // A failure propagates to the deploy script rather than becoming success.
      const nextModel = models[models.indexOf(model) + 1];
      if (nextModel) {
        expect(client[nextModel[0]!.toLowerCase() + nextModel.slice(1)]!.findFirst).not.toHaveBeenCalled();
      }
    },
  );
});
