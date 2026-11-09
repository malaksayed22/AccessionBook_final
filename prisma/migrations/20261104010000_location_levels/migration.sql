-- Location levels (room, row, rack, shelf, area) and capacity counted in units or plants.
CREATE TYPE "LocationKind" AS ENUM ('ROOM', 'ROW', 'RACK', 'SHELF', 'AREA');
CREATE TYPE "CapacityMeasure" AS ENUM ('UNITS', 'PLANTS');
ALTER TABLE "Location"
  ADD COLUMN "kind" "LocationKind" NOT NULL DEFAULT 'ROOM',
  ADD COLUMN "capacityMeasure" "CapacityMeasure" NOT NULL DEFAULT 'UNITS',
  ADD COLUMN "parentId" INTEGER;
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");
