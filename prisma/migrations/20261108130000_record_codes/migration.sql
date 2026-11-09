-- Every record people refer to gets a short code made by the database from a sequence, so every
-- way of creating one is covered: organizations ORG-001, members M-001, cultivars CV-001, tasks
-- T-0001, corrective actions CAPA-001. Existing rows are numbered in the order they were created.

CREATE SEQUENCE "Organization_code_seq";
ALTER TABLE "Organization" ADD COLUMN "code" TEXT;
UPDATE "Organization" x
SET "code" = 'ORG-' || lpad(n.num::text, 3, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS num FROM "Organization") n
WHERE x."id" = n."id";
SELECT setval('"Organization_code_seq"', COALESCE((SELECT count(*) FROM "Organization"), 0) + 1, false);
ALTER TABLE "Organization"
  ALTER COLUMN "code" SET DEFAULT ('ORG-' || lpad(nextval('"Organization_code_seq"')::text, 3, '0')),
  ALTER COLUMN "code" SET NOT NULL;
ALTER SEQUENCE "Organization_code_seq" OWNED BY "Organization"."code";
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

CREATE SEQUENCE "User_code_seq";
ALTER TABLE "User" ADD COLUMN "code" TEXT;
UPDATE "User" x
SET "code" = 'M-' || lpad(n.num::text, 3, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS num FROM "User") n
WHERE x."id" = n."id";
SELECT setval('"User_code_seq"', COALESCE((SELECT count(*) FROM "User"), 0) + 1, false);
ALTER TABLE "User"
  ALTER COLUMN "code" SET DEFAULT ('M-' || lpad(nextval('"User_code_seq"')::text, 3, '0')),
  ALTER COLUMN "code" SET NOT NULL;
ALTER SEQUENCE "User_code_seq" OWNED BY "User"."code";
CREATE UNIQUE INDEX "User_code_key" ON "User"("code");

CREATE SEQUENCE "Task_code_seq";
ALTER TABLE "Task" ADD COLUMN "code" TEXT;
UPDATE "Task" x
SET "code" = 'T-' || lpad(n.num::text, 4, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS num FROM "Task") n
WHERE x."id" = n."id";
SELECT setval('"Task_code_seq"', COALESCE((SELECT count(*) FROM "Task"), 0) + 1, false);
ALTER TABLE "Task"
  ALTER COLUMN "code" SET DEFAULT ('T-' || lpad(nextval('"Task_code_seq"')::text, 4, '0')),
  ALTER COLUMN "code" SET NOT NULL;
ALTER SEQUENCE "Task_code_seq" OWNED BY "Task"."code";
CREATE UNIQUE INDEX "Task_code_key" ON "Task"("code");

CREATE SEQUENCE "CapaAction_code_seq";
ALTER TABLE "CapaAction" ADD COLUMN "code" TEXT;
UPDATE "CapaAction" x
SET "code" = 'CAPA-' || lpad(n.num::text, 3, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS num FROM "CapaAction") n
WHERE x."id" = n."id";
SELECT setval('"CapaAction_code_seq"', COALESCE((SELECT count(*) FROM "CapaAction"), 0) + 1, false);
ALTER TABLE "CapaAction"
  ALTER COLUMN "code" SET DEFAULT ('CAPA-' || lpad(nextval('"CapaAction_code_seq"')::text, 3, '0')),
  ALTER COLUMN "code" SET NOT NULL;
ALTER SEQUENCE "CapaAction_code_seq" OWNED BY "CapaAction"."code";
CREATE UNIQUE INDEX "CapaAction_code_key" ON "CapaAction"("code");

-- Cultivars already had an optional, typed code. It is kept where it was filled in and unique;
-- blank or repeated codes are replaced by a CV- number, and new cultivars always get one.
CREATE SEQUENCE "Cultivar_code_seq";
UPDATE "Cultivar" c SET "code" = NULL
FROM (SELECT "id", row_number() OVER (PARTITION BY upper(trim("code")) ORDER BY "id") AS dup
      FROM "Cultivar" WHERE "code" IS NOT NULL) d
WHERE c."id" = d."id" AND (d.dup > 1 OR trim(c."code") = '');
UPDATE "Cultivar" c
SET "code" = 'CV-' || lpad(n.num::text, 3, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "id") AS num FROM "Cultivar" WHERE "code" IS NULL) n
WHERE c."id" = n."id";
SELECT setval('"Cultivar_code_seq"', COALESCE((SELECT count(*) FROM "Cultivar"), 0) + 1, false);
ALTER TABLE "Cultivar"
  ALTER COLUMN "code" SET DEFAULT ('CV-' || lpad(nextval('"Cultivar_code_seq"')::text, 3, '0')),
  ALTER COLUMN "code" SET NOT NULL;
ALTER SEQUENCE "Cultivar_code_seq" OWNED BY "Cultivar"."code";
CREATE UNIQUE INDEX "Cultivar_code_key" ON "Cultivar"("code");
