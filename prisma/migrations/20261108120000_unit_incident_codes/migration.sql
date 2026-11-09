-- Every unit and every incident gets a short code (U-0001, INC-001), made by the database from a
-- sequence so every way of creating one is covered. Existing rows are numbered in the order they
-- were created.
CREATE SEQUENCE "BiologicalUnit_code_seq";
ALTER TABLE "BiologicalUnit" ADD COLUMN "code" TEXT;
UPDATE "BiologicalUnit" u
SET "code" = 'U-' || lpad(n.num::text, 4, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS num FROM "BiologicalUnit") n
WHERE u."id" = n."id";
SELECT setval('"BiologicalUnit_code_seq"', COALESCE((SELECT count(*) FROM "BiologicalUnit"), 0) + 1, false);
ALTER TABLE "BiologicalUnit"
  ALTER COLUMN "code" SET DEFAULT ('U-' || lpad(nextval('"BiologicalUnit_code_seq"')::text, 4, '0')),
  ALTER COLUMN "code" SET NOT NULL;
ALTER SEQUENCE "BiologicalUnit_code_seq" OWNED BY "BiologicalUnit"."code";
CREATE UNIQUE INDEX "BiologicalUnit_code_key" ON "BiologicalUnit"("code");

CREATE SEQUENCE "QualityIncident_code_seq";
ALTER TABLE "QualityIncident" ADD COLUMN "code" TEXT;
UPDATE "QualityIncident" i
SET "code" = 'INC-' || lpad(n.num::text, 3, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS num FROM "QualityIncident") n
WHERE i."id" = n."id";
SELECT setval('"QualityIncident_code_seq"', COALESCE((SELECT count(*) FROM "QualityIncident"), 0) + 1, false);
ALTER TABLE "QualityIncident"
  ALTER COLUMN "code" SET DEFAULT ('INC-' || lpad(nextval('"QualityIncident_code_seq"')::text, 3, '0')),
  ALTER COLUMN "code" SET NOT NULL;
ALTER SEQUENCE "QualityIncident_code_seq" OWNED BY "QualityIncident"."code";
CREATE UNIQUE INDEX "QualityIncident_code_key" ON "QualityIncident"("code");
