import { IncidentSeverity, TestPanel } from "@/generated/prisma/enums";

/** @deprecated Labels are English. New code uses the id lists at the end of this file. */
export const STAGE_OPTIONS = [
  { id: "VEGETATIVE", label: "Vegetative" },
  { id: "FLOWERING", label: "Flowering" },
  { id: "HARVESTED", label: "Harvested" },
  { id: "DRYING", label: "Drying" },
  { id: "CURING", label: "Curing" },
  { id: "STORAGE", label: "Storage" },
  { id: "SEED", label: "Seed" },
] as const;

export type StageOptionId = (typeof STAGE_OPTIONS)[number]["id"];

export const ACTIVITY_TYPES = [
  { id: "NUTRIENT", label: "Nutrient feed" },
  { id: "FERTIGATION", label: "Fertigation" },
  { id: "FOLIAR", label: "Foliar nutrients" },
  { id: "PESTICIDE", label: "Pesticide application" },
  { id: "BENEFICIAL_INSECTS", label: "Beneficial insects" },
  { id: "SCOUTING", label: "Plant scouting" },
  { id: "PRUNING", label: "Pruning / defoliation" },
  { id: "FLUSH", label: "Flush" },
  { id: "GROW_MEDIA", label: "Grow media" },
  { id: "METRICS", label: "Metrics collection" },
  { id: "POTENCY", label: "THC / CBD result" },
  { id: "TREATMENT", label: "Treatment" },
  { id: "ENVIRONMENT", label: "Environmental condition" },
] as const;

export const ATTACHMENT_CATEGORIES = [
  { id: "PHOTO", label: "Photo" },
  { id: "PROTOCOL", label: "Protocol" },
  { id: "QC", label: "QC document" },
  { id: "COA", label: "Certificate of analysis" },
  { id: "MANIFEST", label: "Shipping manifest" },
] as const;

/*
 * Ids only, for screens that translate the names themselves (`domain.growthStage.<id>`,
 * `domain.activityType.<id>`, `domain.attachmentCategory.<id>`). The labelled lists above stay for
 * the legacy action hub until it is rebuilt.
 */
export const STAGE_OPTION_IDS = STAGE_OPTIONS.map((s) => s.id);
export const ACTIVITY_TYPE_IDS = ACTIVITY_TYPES.map((t) => t.id);
export const ATTACHMENT_CATEGORY_IDS = ATTACHMENT_CATEGORIES.map((c) => c.id);

// --- Choices offered by the unit action forms (enum values; the UI translates them) -----------

export const DERIVE_TYPES = ["clone", "cutting", "subculture"] as const;
export type DeriveType = (typeof DERIVE_TYPES)[number];

/** The values the profile offers for a plant's sex; any other stored value is still shown as is. */
export const SEX_VALUES = ["MALE", "FEMALE", "HERMAPHRODITE"] as const;

export const TEST_PANEL_IDS = Object.values(TestPanel);
export const INCIDENT_SEVERITY_IDS = Object.values(IncidentSeverity);
