-- A version of a procedure may carry its controlled document (PDF or Word).
ALTER TABLE "SopVersion" ADD COLUMN "fileName" TEXT;
ALTER TABLE "SopVersion" ADD COLUMN "filePath" TEXT;
ALTER TABLE "SopVersion" ADD COLUMN "fileMime" TEXT;
ALTER TABLE "SopVersion" ADD COLUMN "fileSize" INTEGER;
ALTER TABLE "SopVersion" ADD COLUMN "fileSha256" TEXT;
