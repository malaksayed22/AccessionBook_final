-- Tissue samples of plants and cultures for lab tests, and two more test panels.
ALTER TYPE "TestPanel" ADD VALUE 'PATHOGENS';
ALTER TYPE "TestPanel" ADD VALUE 'GENETICS';
CREATE TYPE "TissuePurpose" AS ENUM ('PATHOGEN', 'SEX', 'IDENTITY', 'OTHER');

CREATE TABLE "TissueSample" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "unitId" INTEGER NOT NULL,
  "purpose" "TissuePurpose" NOT NULL,
  "tissue" TEXT NOT NULL,
  "note" TEXT,
  "takenAt" TIMESTAMPTZ(3) NOT NULL,
  "takenById" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TissueSample_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TissueSample_code_key" ON "TissueSample"("code");
CREATE INDEX "TissueSample_unitId_idx" ON "TissueSample"("unitId");
ALTER TABLE "TissueSample" ADD CONSTRAINT "TissueSample_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BiologicalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TissueSample" ADD CONSTRAINT "TissueSample_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LabTest" ADD COLUMN "tissueSampleId" INTEGER;
CREATE INDEX "LabTest_tissueSampleId_idx" ON "LabTest"("tissueSampleId");
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_tissueSampleId_fkey" FOREIGN KEY ("tissueSampleId") REFERENCES "TissueSample"("id") ON DELETE SET NULL ON UPDATE CASCADE;
