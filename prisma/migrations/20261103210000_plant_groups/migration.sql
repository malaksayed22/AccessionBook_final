-- Plant groups: a plant unit may hold several plants, split into new groups or merged into another.
ALTER TYPE "UnitStateKind" ADD VALUE 'REGROUPED';
ALTER TYPE "UnitStateKind" ADD VALUE 'MERGED';
ALTER TYPE "SourceType" ADD VALUE 'SPLIT';
ALTER TABLE "UnitState" ADD COLUMN "plantCount" INTEGER;
