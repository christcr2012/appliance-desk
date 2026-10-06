import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKUP_MODEL_POLICY, BACKUP_TABLES } from "@/domains/backup/manifest";
import {
  deriveRestoreTableOrder,
  relationDependencies,
} from "../scripts/lib/table-order";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("backup restore table order", () => {
  it("contains every backed-up model once and after every backed-up dependency", () => {
    const order = deriveRestoreTableOrder(schema, BACKUP_MODEL_POLICY);
    expect(order).toHaveLength(BACKUP_TABLES.length);
    expect(new Set(order)).toEqual(new Set(BACKUP_TABLES));

    const position = new Map(order.map((delegate, index) => [delegate, index]));
    for (const relation of relationDependencies(schema)) {
      const modelDelegate = BACKUP_MODEL_POLICY[relation.model as keyof typeof BACKUP_MODEL_POLICY];
      const dependencyDelegate =
        BACKUP_MODEL_POLICY[relation.dependsOn as keyof typeof BACKUP_MODEL_POLICY];
      if (!modelDelegate || !dependencyDelegate) continue;
      expect(
        position.get(dependencyDelegate),
        \`\${relation.dependsOn} must restore before \${relation.model}\`,
      ).toBeLessThan(position.get(modelDelegate)!);
    }
  });
});
