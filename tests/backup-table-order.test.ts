import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKUP_MODEL_POLICY, BACKUP_TABLES } from "@/domains/backup/manifest";
import {
  deriveRestoreTableOrder,
  relationDependencies,
  bigIntFieldsByDelegate,
} from "../scripts/lib/table-order";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("backup restore table order", () => {
  it("ignores mapped OAuth credentials when excluded but rejects mapped business tables", () => {
    expect(() => deriveRestoreTableOrder(schema, BACKUP_MODEL_POLICY)).not.toThrow();
    const mapped = `model Custom {\n  id String @id\n  @@map("actuallyStoredElsewhere")\n}`;
    expect(() => deriveRestoreTableOrder(mapped, { Custom: "custom" })).toThrow(/mapped Prisma table/);
    expect(() => deriveRestoreTableOrder(mapped, { Custom: null })).not.toThrow();
  });
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
        `${relation.dependsOn} must restore before ${relation.model}`,
      ).toBeLessThan(position.get(modelDelegate)!);
    }
  });
});
it("restores V2 signed and adviser proof before trigger-verified dependent records",()=>{
 const order=deriveRestoreTableOrder(schema,BACKUP_MODEL_POLICY);
 expect(order.indexOf("signatureRecord")).toBeLessThan(order.indexOf("agreementSigningPayment"));
 expect(order.indexOf("agreementSigningCharge")).toBeLessThan(order.indexOf("signingBusinessReview"));
});

it("keeps posting revisions lossless and defers nullable bank history chains for restore",()=>{
 const fields=bigIntFieldsByDelegate(schema,BACKUP_MODEL_POLICY);
 expect(fields.booksPostingRevision).toContain("revision");
 const deps=relationDependencies(schema);
 expect(deps).not.toContainEqual({model:"BackupArtifact",dependsOn:"BackupArtifact"});
 expect(deps).not.toContainEqual({model:"BankImport",dependsOn:"BankImport"});
 expect(deps).not.toContainEqual({model:"BankReconciliation",dependsOn:"BankReconciliation"});
 expect(deps).not.toContainEqual({model:"BookCashEvent",dependsOn:"BookCashEvent"});
 expect(deps).not.toContainEqual({model:"AccountingDelivery",dependsOn:"AccountingDelivery"});
 const order=deriveRestoreTableOrder(schema,BACKUP_MODEL_POLICY);
 expect(order.indexOf("cashAccount")).toBeLessThan(order.indexOf("bankImport"));
 expect(order.indexOf("bankImport")).toBeLessThan(order.indexOf("bankObservation"));
 expect(order.indexOf("bankMatchGroup")).toBeLessThan(order.indexOf("bankMatchItem"));
 expect(order.indexOf("bankObservation")).toBeLessThan(order.indexOf("bankMatchItem"));
});
