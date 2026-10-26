-- LD-1: compare-and-set token for the follow-up date. Bumped only by
-- setLeadFollowUp, so two people editing the same lead's follow-up in
-- different sessions can't silently overwrite each other. Additive.
ALTER TABLE "Lead" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
