-- DEC-2: when the owner last reviewed the researched starting values. The To do item "starting values are now in use"
-- counts starting values applied after this time and goes away once the owner marks them reviewed. Additive and nullable.
ALTER TABLE "BusinessSettings" ADD COLUMN "decisionsReviewedAt" TIMESTAMP(3);
