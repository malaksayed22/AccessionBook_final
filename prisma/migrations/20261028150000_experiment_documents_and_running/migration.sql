-- An experiment is Running until someone completes it; completing sets its end date. A planned end
-- date is no longer recorded, so any end date still in the future (an old plan, not a completion)
-- is cleared and the experiment simply runs.
UPDATE "Experiment" SET "endDate" = NULL WHERE "endDate" > now();

-- Documents that belong to an experiment as a whole.
-- CreateTable
CREATE TABLE "ExperimentAttachment" (
    "id" SERIAL NOT NULL,
    "experimentId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,

    CONSTRAINT "ExperimentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExperimentAttachment_experimentId_idx" ON "ExperimentAttachment"("experimentId");

-- CreateIndex
CREATE INDEX "ExperimentAttachment_userId_idx" ON "ExperimentAttachment"("userId");

-- AddForeignKey
ALTER TABLE "ExperimentAttachment" ADD CONSTRAINT "ExperimentAttachment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAttachment" ADD CONSTRAINT "ExperimentAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Regulated records are voided (with who and why), never deleted.
ALTER TABLE "ExperimentAttachment" ADD CONSTRAINT "ExperimentAttachment_void_check"
  CHECK ("voidedAt" IS NULL OR ("voidedById" IS NOT NULL AND btrim(coalesce("voidReason", '')) <> ''));
CREATE TRIGGER experiment_attachment_no_delete BEFORE DELETE ON "ExperimentAttachment"
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
