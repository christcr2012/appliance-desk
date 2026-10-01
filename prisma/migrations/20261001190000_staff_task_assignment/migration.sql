CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
ALTER TABLE "StaffTask"
  ADD COLUMN "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "assigneeUserId" TEXT;
CREATE INDEX "StaffTask_assigneeUserId_completedAt_idx" ON "StaffTask"("assigneeUserId", "completedAt");
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_assigneeUserId_fkey"
  FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
