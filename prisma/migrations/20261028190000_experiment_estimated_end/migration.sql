-- An experiment can carry an optional estimated end date (informational; the end date is set by completing it).
-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN     "estimatedEndDate" TIMESTAMPTZ(3);

