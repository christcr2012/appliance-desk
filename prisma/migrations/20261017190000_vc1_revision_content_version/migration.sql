-- V-C1: website revisions record how their content is stored. Existing rows are plain text (version 1) and are not rewritten.
ALTER TABLE "SiteContentRevision" ADD COLUMN "contentSchemaVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SiteContentRevision" ADD COLUMN "templateVersion" TEXT;
