-- Cultivar growth profile: days per stage and expected yield, for projected harvest dates.
ALTER TABLE "Cultivar"
  ADD COLUMN "vegetativeDays" INTEGER,
  ADD COLUMN "floweringDays" INTEGER,
  ADD COLUMN "expectedYieldGrams" DOUBLE PRECISION;
