-- Work planned by laboratory day, for the lab, an experiment or a unit.
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

CREATE TABLE "Task" (
  "id" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "details" TEXT,
  "dueDate" TIMESTAMPTZ(3) NOT NULL,
  "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "experimentId" INTEGER,
  "unitId" INTEGER,
  "assigneeId" INTEGER,
  "createdById" INTEGER NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "completedById" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");
CREATE INDEX "Task_experimentId_idx" ON "Task"("experimentId");
CREATE INDEX "Task_unitId_idx" ON "Task"("unitId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BiologicalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
