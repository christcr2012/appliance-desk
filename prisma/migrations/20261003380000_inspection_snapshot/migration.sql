-- Batch C P2-E: inspections keep the checklist they were answered against, and staff job scope gets its setting.

CREATE TABLE "InspectionChecklistVersion" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "items" JSONB NOT NULL,
  "hash" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedByUserId" TEXT,
  CONSTRAINT "InspectionChecklistVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InspectionChecklistVersion_version_key" ON "InspectionChecklistVersion"("version");

ALTER TABLE "ApplianceInspection" ADD COLUMN "checklistDefinition" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ApplianceInspection" ADD COLUMN "checklistVersionId" TEXT;
ALTER TABLE "ApplianceInspection" ADD COLUMN "jobId" TEXT;
ALTER TABLE "ApplianceInspection" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "ApplianceInspection" ADD COLUMN "overriddenByUserId" TEXT;
ALTER TABLE "ApplianceInspection" ADD CONSTRAINT "ApplianceInspection_checklistVersionId_fkey"
  FOREIGN KEY ("checklistVersionId") REFERENCES "InspectionChecklistVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ApplianceInspectionAmendment" (
  "id" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplianceInspectionAmendment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApplianceInspectionAmendment_inspectionId_idx" ON "ApplianceInspectionAmendment"("inspectionId");
ALTER TABLE "ApplianceInspectionAmendment" ADD CONSTRAINT "ApplianceInspectionAmendment_inspectionId_fkey"
  FOREIGN KEY ("inspectionId") REFERENCES "ApplianceInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BusinessSettings" ADD COLUMN "staffMayWorkUnassignedJobs" BOOLEAN NOT NULL DEFAULT true;

-- Older inspections: the definition is their own answered item texts, in order, and they point at no version row.
UPDATE "ApplianceInspection" i SET "checklistDefinition" = COALESCE(
  (SELECT jsonb_agg(t.e->>'item' ORDER BY t.ord) FROM jsonb_array_elements(i."checklist") WITH ORDINALITY AS t(e, ord)),
  '[]'::jsonb)
WHERE jsonb_typeof(i."checklist") = 'array';

-- Version 1 is the owner's saved list when there is one, otherwise the built-in list.
-- The built-in hash is the sha256 of the compact JSON text, produced by the same TypeScript helper the app uses.
INSERT INTO "InspectionChecklistVersion" ("id", "version", "items", "hash", "publishedAt", "publishedByUserId")
SELECT 'seed_v1', 1, c.items, c.hash, NOW(), NULL
FROM (
  SELECT
    CASE WHEN s.custom THEN s.list
         ELSE '["Cleaned inside and out","Runs a full cycle without errors","No leaks","Hoses, cords, and vents intact","Door, seals, and controls work"]'::jsonb END AS items,
    CASE WHEN s.custom
         THEN encode(sha256(convert_to('[' || (SELECT string_agg(to_json(e)::text, ',' ORDER BY o) FROM jsonb_array_elements_text(s.list) WITH ORDINALITY AS x(e, o)) || ']', 'UTF8')), 'hex')
         ELSE 'add956c88ba213acfae86f29ba4c1714bc4545012a3f717667f16b2b0bce045c' END AS hash
  FROM (
    SELECT COALESCE(b."inspectionChecklist", '[]'::jsonb) AS list,
           (b."inspectionChecklist" IS NOT NULL AND jsonb_typeof(b."inspectionChecklist") = 'array'
            AND jsonb_array_length(b."inspectionChecklist") > 0
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b."inspectionChecklist") z WHERE jsonb_typeof(z) <> 'string')) AS custom
    FROM (SELECT 1) one LEFT JOIN "BusinessSettings" b ON b."id" = 'singleton'
  ) s
) c
ON CONFLICT ("version") DO NOTHING;

-- A recorded inspection can never be changed or deleted. Corrections are added as amendments.
CREATE FUNCTION "inspection_append_only"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Inspections cannot be changed or deleted. Add an amendment instead.'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "ApplianceInspection_append_only" BEFORE UPDATE OR DELETE ON "ApplianceInspection"
  FOR EACH ROW EXECUTE FUNCTION "inspection_append_only"();
