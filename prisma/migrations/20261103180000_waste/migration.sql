-- Waste: part of a unit disposed of (trim, stems and leaves, roots, plant matter), booked as destroyed.
ALTER TYPE "UnitStateKind" ADD VALUE 'WASTED';
CREATE TYPE "WasteType" AS ENUM ('TRIM', 'STEMS_LEAVES', 'ROOTS', 'PLANT_MATTER', 'OTHER');
ALTER TABLE "UnitState" ADD COLUMN "wasteType" "WasteType";
