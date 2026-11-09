-- Corrective and preventive actions on incidents and deviations.
CREATE TYPE "CapaKind" AS ENUM ('CORRECTIVE', 'PREVENTIVE');
CREATE TYPE "CapaStatus" AS ENUM ('OPEN', 'DONE', 'VERIFIED');

CREATE TABLE "CapaAction" (
  "id" SERIAL NOT NULL,
  "incidentId" INTEGER NOT NULL,
  "kind" "CapaKind" NOT NULL,
  "description" TEXT NOT NULL,
  "ownerId" INTEGER,
  "dueDate" TIMESTAMPTZ(3),
  "status" "CapaStatus" NOT NULL DEFAULT 'OPEN',
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "completedById" INTEGER,
  "completionNote" TEXT,
  "verifiedAt" TIMESTAMPTZ(3),
  "verifiedById" INTEGER,
  "verificationNote" TEXT,
  CONSTRAINT "CapaAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CapaAction_incidentId_idx" ON "CapaAction"("incidentId");
CREATE INDEX "CapaAction_ownerId_status_idx" ON "CapaAction"("ownerId", "status");

ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "QualityIncident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
