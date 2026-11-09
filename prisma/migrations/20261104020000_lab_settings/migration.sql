-- The laboratory's settings: licence details, how far back events may be dated, the code prefix.
CREATE TABLE "LabSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "licenceNumber" TEXT,
  "licenceHolder" TEXT,
  "licenceClass" "LicenceClass",
  "siteAddress" TEXT,
  "backdateLimitDays" INTEGER,
  "experimentCodePrefix" TEXT NOT NULL DEFAULT 'EXP',
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabSettings_pkey" PRIMARY KEY ("id")
);
