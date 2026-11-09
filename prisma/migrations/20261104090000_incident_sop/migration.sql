-- An incident may name the procedure it departed from: a deviation.
ALTER TABLE "QualityIncident" ADD COLUMN "sopId" INTEGER;
CREATE INDEX "QualityIncident_sopId_idx" ON "QualityIncident"("sopId");
ALTER TABLE "QualityIncident" ADD CONSTRAINT "QualityIncident_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
