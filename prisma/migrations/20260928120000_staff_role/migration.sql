-- Staff permissions framework (Task #66, docs/DECISIONS.md 2026-09-28) —
-- a new STAFF login role, in between CUSTOMER and OWNER/ADMIN. No
-- existing rows use this value, so adding it is not destructive.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'STAFF';
