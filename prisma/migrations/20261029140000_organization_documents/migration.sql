-- Documents filed with an organization.
CREATE TABLE "OrganizationAttachment" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationAttachment_organizationId_idx" ON "OrganizationAttachment"("organizationId");
CREATE INDEX "OrganizationAttachment_userId_idx" ON "OrganizationAttachment"("userId");

ALTER TABLE "OrganizationAttachment" ADD CONSTRAINT "OrganizationAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationAttachment" ADD CONSTRAINT "OrganizationAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
