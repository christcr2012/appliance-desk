ALTER TABLE "BusinessSettings" ADD COLUMN "signingMandatoryPolicyVersions" JSONB NOT NULL DEFAULT '[]'::jsonb;
