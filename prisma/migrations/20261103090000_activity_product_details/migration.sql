-- Cultivation activity logs: what was applied, its pest-control registration number, how much and how.
ALTER TABLE "UnitActivity"
  ADD COLUMN "product" TEXT,
  ADD COLUMN "pcpNumber" TEXT,
  ADD COLUMN "amount" DECIMAL(12,3),
  ADD COLUMN "amountUnit" TEXT,
  ADD COLUMN "method" TEXT;
