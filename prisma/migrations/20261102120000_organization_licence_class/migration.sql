-- The Health Canada licence class of a counterparty, for the CTLS shipped lines.
CREATE TYPE "LicenceClass" AS ENUM ('CULTIVATION', 'PROCESSING', 'ANALYTICAL_TESTING', 'RESEARCH', 'MEDICAL_SALES');

ALTER TABLE "Organization" ADD COLUMN "licenceClass" "LicenceClass";
