-- Standard operating procedures: versions, approval, and staff sign-off.
CREATE TYPE "SopVersionStatus" AS ENUM ('DRAFT', 'EFFECTIVE', 'SUPERSEDED');

CREATE TABLE "Sop" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Sop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Sop_code_key" ON "Sop"("code");

CREATE TABLE "SopVersion" (
  "id" SERIAL NOT NULL,
  "sopId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "SopVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "body" TEXT NOT NULL,
  "changeNote" TEXT,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedById" INTEGER,
  "approvedAt" TIMESTAMPTZ(3),
  "supersededAt" TIMESTAMPTZ(3),
  CONSTRAINT "SopVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SopVersion_sopId_version_key" ON "SopVersion"("sopId", "version");
CREATE INDEX "SopVersion_status_idx" ON "SopVersion"("status");
-- At most one version of a procedure in effect, and at most one draft.
CREATE UNIQUE INDEX "SopVersion_one_effective" ON "SopVersion"("sopId") WHERE "status" = 'EFFECTIVE';
CREATE UNIQUE INDEX "SopVersion_one_draft" ON "SopVersion"("sopId") WHERE "status" = 'DRAFT';

CREATE TABLE "SopSignoff" (
  "id" SERIAL NOT NULL,
  "versionId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "signedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SopSignoff_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SopSignoff_versionId_userId_key" ON "SopSignoff"("versionId", "userId");
CREATE INDEX "SopSignoff_userId_idx" ON "SopSignoff"("userId");

ALTER TABLE "Sop" ADD CONSTRAINT "Sop_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SopSignoff" ADD CONSTRAINT "SopSignoff_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SopSignoff" ADD CONSTRAINT "SopSignoff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
