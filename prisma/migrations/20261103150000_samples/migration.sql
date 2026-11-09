-- Samples: part of a unit taken as a unit of its own (release, retention or internal QA).
ALTER TYPE "UnitStateKind" ADD VALUE 'SAMPLED';
CREATE TYPE "SampleKind" AS ENUM ('RELEASE', 'RETENTION', 'INTERNAL_QA');
ALTER TABLE "BiologicalUnit" ADD COLUMN "sampleKind" "SampleKind";
