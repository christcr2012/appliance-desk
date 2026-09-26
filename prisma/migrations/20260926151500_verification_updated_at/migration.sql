-- Better Auth's verification table expects an updatedAt column.
ALTER TABLE "Verification" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();
