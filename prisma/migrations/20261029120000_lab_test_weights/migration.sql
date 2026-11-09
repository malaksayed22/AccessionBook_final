-- A lab result is a panel, an optional value and the wet and dry weights; the analyte is no longer asked for.
ALTER TABLE "LabTest" ALTER COLUMN "analyte" DROP NOT NULL;
ALTER TABLE "LabTest" ADD COLUMN "wetWeight" DOUBLE PRECISION;
ALTER TABLE "LabTest" ADD COLUMN "dryWeight" DOUBLE PRECISION;
