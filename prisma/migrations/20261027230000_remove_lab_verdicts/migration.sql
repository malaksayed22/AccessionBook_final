-- Lab results are records of what the laboratory reported, not pass/fail judgements.
-- Removes the verdict, the limits it was computed from, and the automatic hold a failing
-- result used to place. Holds already placed that way become manual holds; their reason text
-- ("Auto-hold: failed ...") is kept. The conversion happens in the type change, so the guard
-- on released holds is not touched.

-- AlterEnum
BEGIN;
CREATE TYPE "HoldOrigin_new" AS ENUM ('MANUAL', 'AUTO_INCIDENT');
ALTER TABLE "UnitHold" ALTER COLUMN "origin" DROP DEFAULT;
ALTER TABLE "UnitHold" ALTER COLUMN "origin" TYPE "HoldOrigin_new"
  USING (CASE WHEN "origin"::text = 'AUTO_TEST' THEN 'MANUAL' ELSE "origin"::text END::"HoldOrigin_new");
ALTER TYPE "HoldOrigin" RENAME TO "HoldOrigin_old";
ALTER TYPE "HoldOrigin_new" RENAME TO "HoldOrigin";
DROP TYPE "HoldOrigin_old";
ALTER TABLE "UnitHold" ALTER COLUMN "origin" SET DEFAULT 'MANUAL';
COMMIT;

-- DropIndex
DROP INDEX "LabTest_verdict_idx";

-- AlterTable
ALTER TABLE "LabTest" DROP COLUMN "limitMax",
DROP COLUMN "limitMin",
DROP COLUMN "verdict";

-- DropEnum
DROP TYPE "TestVerdict";
