-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('ADMIN', 'REGULAR');

-- CreateEnum
CREATE TYPE "ExperimentRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('PLANT', 'SEEDLOT', 'FLOWER', 'CULTURE');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('SEED', 'CUTTING', 'CLONE', 'SUBCULTURE', 'RECEIVED', 'INTERNAL', 'HARVEST', 'OTHER');

-- CreateEnum
CREATE TYPE "GrowthStage" AS ENUM ('VEGETATIVE', 'FLOWERING', 'HARVESTED', 'DRYING', 'CURING', 'STORAGE', 'SEED');

-- CreateEnum
CREATE TYPE "UnitStateKind" AS ENUM ('CREATED', 'RECEIVED', 'MOVED', 'STAGE_CHANGED', 'MEASURED', 'SHIPPED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "HoldKind" AS ENUM ('HOLD', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "HoldOrigin" AS ENUM ('MANUAL', 'AUTO_TEST', 'AUTO_INCIDENT');

-- CreateEnum
CREATE TYPE "ShipmentDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaterialClass" AS ENUM ('SEED', 'CLONE', 'PLANT', 'CULTURE', 'FLOWER', 'TRIM');

-- CreateEnum
CREATE TYPE "Measure" AS ENUM ('COUNT', 'WEIGHT');

-- CreateEnum
CREATE TYPE "Moisture" AS ENUM ('WET', 'DRY');

-- CreateEnum
CREATE TYPE "TestPanel" AS ENUM ('POTENCY', 'TERPENES', 'PESTICIDES', 'HEAVY_METALS', 'MICROBIALS', 'MYCOTOXINS', 'MOISTURE', 'FOREIGN', 'OTHER');

-- CreateEnum
CREATE TYPE "TestVerdict" AS ENUM ('PASS', 'FAIL', 'INCONCLUSIVE', 'RECORDED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'CLOSED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('NUTRIENT', 'FERTIGATION', 'FOLIAR', 'PESTICIDE', 'BENEFICIAL_INSECTS', 'SCOUTING', 'PRUNING', 'FLUSH', 'GROW_MEDIA', 'METRICS', 'POTENCY', 'TREATMENT', 'ENVIRONMENT');

-- CreateEnum
CREATE TYPE "AttachmentCategory" AS ENUM ('PHOTO', 'PROTOCOL', 'QC', 'COA', 'MANIFEST');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "permissions" "PermissionLevel" NOT NULL DEFAULT 'REGULAR',
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMPTZ(3),
    "invitedById" INTEGER,
    "invitedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cultivar" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "commonName" TEXT,
    "category" TEXT,
    "targetThc" DOUBLE PRECISION,
    "targetCbd" DOUBLE PRECISION,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Cultivar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" SERIAL NOT NULL,
    "ecode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMPTZ(3) NOT NULL,
    "endDate" TIMESTAMPTZ(3),
    "comment" TEXT,
    "parentExperimentId" INTEGER,
    "sourceUnitId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentCodeCounter" (
    "prefix" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExperimentCodeCounter_pkey" PRIMARY KEY ("prefix")
);

-- CreateTable
CREATE TABLE "ExperimentMember" (
    "experimentId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "ExperimentRole" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "ExperimentMember_pkey" PRIMARY KEY ("experimentId","userId")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "comment" TEXT,
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "country" TEXT,
    "comment" TEXT,
    "licenceNumber" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiologicalUnit" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "UnitType" NOT NULL,
    "cultivarId" INTEGER,
    "experimentId" INTEGER,
    "sex" TEXT,
    "comment" TEXT,
    "sourceType" "SourceType",
    "sourceDescription" TEXT,
    "providerOrganizationId" INTEGER,
    "sourceParentUnitId" INTEGER,
    "currentStateId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BiologicalUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitState" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "UnitStateKind" NOT NULL,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" INTEGER NOT NULL,
    "locationId" INTEGER,
    "growthStage" "GrowthStage",
    "humidWeight" DECIMAL(12,3),
    "dryWeight" DECIMAL(12,3),
    "seedCount" INTEGER,
    "organizationId" INTEGER,
    "scanConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "witnessId" INTEGER,
    "comment" TEXT,
    "parentStateId" INTEGER,

    CONSTRAINT "UnitState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitHold" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "kind" "HoldKind" NOT NULL DEFAULT 'HOLD',
    "reason" TEXT NOT NULL,
    "origin" "HoldOrigin" NOT NULL DEFAULT 'MANUAL',
    "placedById" INTEGER NOT NULL,
    "placedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" INTEGER,
    "releasedAt" TIMESTAMPTZ(3),
    "releaseNote" TEXT,

    CONSTRAINT "UnitHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "userId" INTEGER NOT NULL,
    "userName" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "entityLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "reason" TEXT,
    "requestId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevHash" TEXT NOT NULL DEFAULT '',
    "hash" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitAttachment" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "category" "AttachmentCategory" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,

    CONSTRAINT "UnitAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitActivity" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "stateId" INTEGER,
    "type" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "date" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "direction" "ShipmentDirection" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "organizationId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "shippedDate" TIMESTAMPTZ(3),
    "deliveredDate" TIMESTAMPTZ(3),
    "trackingNumber" TEXT,
    "address" TEXT,
    "licenceNumber" TEXT,
    "manifestNumber" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "unitId" INTEGER,
    "cultivarId" INTEGER,
    "stateId" INTEGER,
    "description" TEXT NOT NULL,
    "materialType" "MaterialClass" NOT NULL,
    "measure" "Measure" NOT NULL,
    "unitCount" INTEGER,
    "weightGrams" DECIMAL(12,3),
    "moisture" "Moisture",
    "comment" TEXT,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTest" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "panel" "TestPanel" NOT NULL,
    "analyte" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "uom" TEXT,
    "limitMin" DOUBLE PRECISION,
    "limitMax" DOUBLE PRECISION,
    "verdict" "TestVerdict" NOT NULL,
    "labName" TEXT,
    "testedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,

    CONSTRAINT "LabTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityIncident" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "unitId" INTEGER,
    "cultivarId" INTEGER,
    "experimentId" INTEGER,
    "userId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,

    CONSTRAINT "QualityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteTokenHash_key" ON "User"("inviteTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Cultivar_name_key" ON "Cultivar"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_ecode_key" ON "Experiment"("ecode");

-- CreateIndex
CREATE INDEX "Experiment_parentExperimentId_idx" ON "Experiment"("parentExperimentId");

-- CreateIndex
CREATE INDEX "Experiment_sourceUnitId_idx" ON "Experiment"("sourceUnitId");

-- CreateIndex
CREATE INDEX "ExperimentMember_userId_idx" ON "ExperimentMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BiologicalUnit_name_key" ON "BiologicalUnit"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BiologicalUnit_currentStateId_key" ON "BiologicalUnit"("currentStateId");

-- CreateIndex
CREATE INDEX "BiologicalUnit_experimentId_idx" ON "BiologicalUnit"("experimentId");

-- CreateIndex
CREATE INDEX "BiologicalUnit_cultivarId_idx" ON "BiologicalUnit"("cultivarId");

-- CreateIndex
CREATE INDEX "BiologicalUnit_sourceParentUnitId_idx" ON "BiologicalUnit"("sourceParentUnitId");

-- CreateIndex
CREATE INDEX "BiologicalUnit_providerOrganizationId_idx" ON "BiologicalUnit"("providerOrganizationId");

-- CreateIndex
CREATE INDEX "UnitState_unitId_effectiveAt_idx" ON "UnitState"("unitId", "effectiveAt");

-- CreateIndex
CREATE INDEX "UnitState_kind_effectiveAt_idx" ON "UnitState"("kind", "effectiveAt");

-- CreateIndex
CREATE INDEX "UnitState_locationId_idx" ON "UnitState"("locationId");

-- CreateIndex
CREATE INDEX "UnitState_organizationId_idx" ON "UnitState"("organizationId");

-- CreateIndex
CREATE INDEX "UnitState_recordedById_idx" ON "UnitState"("recordedById");

-- CreateIndex
CREATE INDEX "UnitState_parentStateId_idx" ON "UnitState"("parentStateId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitState_unitId_sequence_key" ON "UnitState"("unitId", "sequence");

-- CreateIndex
CREATE INDEX "UnitHold_unitId_releasedAt_idx" ON "UnitHold"("unitId", "releasedAt");

-- CreateIndex
CREATE INDEX "UnitHold_releasedAt_idx" ON "UnitHold"("releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_seq_key" ON "AuditLog"("seq");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "UnitAttachment_unitId_idx" ON "UnitAttachment"("unitId");

-- CreateIndex
CREATE INDEX "UnitAttachment_userId_idx" ON "UnitAttachment"("userId");

-- CreateIndex
CREATE INDEX "UnitActivity_unitId_date_idx" ON "UnitActivity"("unitId", "date");

-- CreateIndex
CREATE INDEX "UnitActivity_userId_idx" ON "UnitActivity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_reference_key" ON "Shipment"("reference");

-- CreateIndex
CREATE INDEX "Shipment_direction_status_idx" ON "Shipment"("direction", "status");

-- CreateIndex
CREATE INDEX "Shipment_shippedDate_idx" ON "Shipment"("shippedDate");

-- CreateIndex
CREATE INDEX "Shipment_organizationId_idx" ON "Shipment"("organizationId");

-- CreateIndex
CREATE INDEX "Shipment_userId_idx" ON "Shipment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentItem_stateId_key" ON "ShipmentItem"("stateId");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipmentId_idx" ON "ShipmentItem"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentItem_unitId_idx" ON "ShipmentItem"("unitId");

-- CreateIndex
CREATE INDEX "ShipmentItem_cultivarId_idx" ON "ShipmentItem"("cultivarId");

-- CreateIndex
CREATE INDEX "LabTest_unitId_testedAt_idx" ON "LabTest"("unitId", "testedAt");

-- CreateIndex
CREATE INDEX "LabTest_verdict_idx" ON "LabTest"("verdict");

-- CreateIndex
CREATE INDEX "LabTest_userId_idx" ON "LabTest"("userId");

-- CreateIndex
CREATE INDEX "QualityIncident_status_severity_idx" ON "QualityIncident"("status", "severity");

-- CreateIndex
CREATE INDEX "QualityIncident_unitId_idx" ON "QualityIncident"("unitId");

-- CreateIndex
CREATE INDEX "QualityIncident_cultivarId_idx" ON "QualityIncident"("cultivarId");

-- CreateIndex
CREATE INDEX "QualityIncident_experimentId_idx" ON "QualityIncident"("experimentId");

-- CreateIndex
CREATE INDEX "QualityIncident_userId_idx" ON "QualityIncident"("userId");

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_parentExperimentId_fkey" FOREIGN KEY ("parentExperimentId") REFERENCES "Experiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_sourceUnitId_fkey" FOREIGN KEY ("sourceUnitId") REFERENCES "BiologicalUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentMember" ADD CONSTRAINT "ExperimentMember_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentMember" ADD CONSTRAINT "ExperimentMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiologicalUnit" ADD CONSTRAINT "BiologicalUnit_cultivarId_fkey" FOREIGN KEY ("cultivarId") REFERENCES "Cultivar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiologicalUnit" ADD CONSTRAINT "BiologicalUnit_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiologicalUnit" ADD CONSTRAINT "BiologicalUnit_providerOrganizationId_fkey" FOREIGN KEY ("providerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiologicalUnit" ADD CONSTRAINT "BiologicalUnit_sourceParentUnitId_fkey" FOREIGN KEY ("sourceParentUnitId") REFERENCES "BiologicalUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiologicalUnit" ADD CONSTRAINT "BiologicalUnit_currentStateId_fkey" FOREIGN KEY ("currentStateId") REFERENCES "UnitState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BiologicalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_witnessId_fkey" FOREIGN KEY ("witnessId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_parentStateId_fkey" FOREIGN KEY ("parentStateId") REFERENCES "UnitState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitHold" ADD CONSTRAINT "UnitHold_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BiologicalUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitHold" ADD CONSTRAINT "UnitHold_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitHold" ADD CONSTRAINT "UnitHold_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAttachment" ADD CONSTRAINT "UnitAttachment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BiologicalUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAttachment" ADD CONSTRAINT "UnitAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitActivity" ADD CONSTRAINT "UnitActivity_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BiologicalUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitActivity" ADD CONSTRAINT "UnitActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BiologicalUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_cultivarId_fkey" FOREIGN KEY ("cultivarId") REFERENCES "Cultivar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "UnitState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BiologicalUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityIncident" ADD CONSTRAINT "QualityIncident_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BiologicalUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityIncident" ADD CONSTRAINT "QualityIncident_cultivarId_fkey" FOREIGN KEY ("cultivarId") REFERENCES "Cultivar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityIncident" ADD CONSTRAINT "QualityIncident_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityIncident" ADD CONSTRAINT "QualityIncident_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

