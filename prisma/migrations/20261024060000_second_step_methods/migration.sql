-- Additive (Batch ACC, ACC-3). Which sign-in code method a person uses, the owner's per-level method policy, and the
-- separate switch for text sign-in codes (off). Nothing existing changes; everyone keeps their authenticator app.
ALTER TABLE "User" ADD COLUMN "secondStepMethod" TEXT;
ALTER TABLE "BusinessSettings" ADD COLUMN "secondStepMethodsByLevel" JSONB NOT NULL DEFAULT '{"OWNER":["TOTP","SMS"],"ADMIN":["TOTP","SMS"],"STAFF":["TOTP","SMS","EMAIL"]}';
ALTER TABLE "BusinessSettings" ADD COLUMN "securitySmsEnabled" BOOLEAN NOT NULL DEFAULT false;
-- People who already turned on two-step used the authenticator app.
UPDATE "User" SET "secondStepMethod" = 'TOTP' WHERE "twoFactorEnabled" = true;
