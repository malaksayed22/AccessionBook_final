-- Every room has a short code; existing rooms get one from their number (R-001).
ALTER TABLE "Location" ADD COLUMN "code" TEXT;
UPDATE "Location" SET "code" = 'R-' || lpad("id"::text, 3, '0') WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");
