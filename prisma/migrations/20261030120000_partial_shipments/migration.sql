-- Shipping can take part of a unit: a new event kind, and how much left on each shipment.
ALTER TYPE "UnitStateKind" ADD VALUE 'SHIPPED_PART' BEFORE 'SHIPPED';

ALTER TABLE "UnitState" ADD COLUMN "shippedWeight" DECIMAL(12,3);
ALTER TABLE "UnitState" ADD COLUMN "shippedMoisture" "Moisture";
ALTER TABLE "UnitState" ADD COLUMN "shippedCount" INTEGER;

ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_shipped_quantities_check"
  CHECK (("shippedWeight" IS NULL OR "shippedWeight" > 0) AND ("shippedCount" IS NULL OR "shippedCount" > 0));
