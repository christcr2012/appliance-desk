-- Fixes a real bug found while creating Chris's OWNER account: Better
-- Auth's own schema expects `User.emailVerified` to be a boolean
-- (defaults to false), not a nullable timestamp. The original hand-written
-- migration used the Auth.js/NextAuth convention (DateTime) by mistake —
-- see docs/DECISIONS.md. The User table has no rows yet, so this is a
-- safe, non-destructive type change.
ALTER TABLE "User" ALTER COLUMN "emailVerified" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "emailVerified" TYPE BOOLEAN USING ("emailVerified" IS NOT NULL);
ALTER TABLE "User" ALTER COLUMN "emailVerified" SET DEFAULT false;
ALTER TABLE "User" ALTER COLUMN "emailVerified" SET NOT NULL;
