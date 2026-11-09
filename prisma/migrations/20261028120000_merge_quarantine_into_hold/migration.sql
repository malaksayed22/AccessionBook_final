-- A unit is Active, On hold, Shipped or Destroyed. Quarantine is not a separate kind of hold:
-- holds that were placed as quarantine become plain holds, with their reason and history kept.
-- The conversion happens in the type change, so the guard on released holds is not touched.

-- AlterEnum
BEGIN;
CREATE TYPE "HoldKind_new" AS ENUM ('HOLD');
ALTER TABLE "UnitHold" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "UnitHold" ALTER COLUMN "kind" TYPE "HoldKind_new" USING ('HOLD'::"HoldKind_new");
ALTER TYPE "HoldKind" RENAME TO "HoldKind_old";
ALTER TYPE "HoldKind_new" RENAME TO "HoldKind";
DROP TYPE "HoldKind_old";
ALTER TABLE "UnitHold" ALTER COLUMN "kind" SET DEFAULT 'HOLD';
COMMIT;
