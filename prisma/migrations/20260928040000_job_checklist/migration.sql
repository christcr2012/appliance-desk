-- Per-job completion checklist (dispatch board / Task #42) — see the
-- Job.checklist field's own comment in prisma/schema.prisma.
ALTER TABLE "Job" ADD COLUMN "checklist" JSONB NOT NULL DEFAULT '[]';
