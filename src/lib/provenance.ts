/** Kinds of material source, as stored on a unit. Names live in `experiments.provenance.sourceTypes`. */
export const SOURCE_TYPES = [
  { id: "SEED" },
  { id: "CUTTING" },
  { id: "CLONE" },
  { id: "SUBCULTURE" },
  { id: "RECEIVED" },
  { id: "INTERNAL" },
  { id: "HARVEST" },
  { id: "OTHER" },
] as const;

export type SourceTypeId = (typeof SOURCE_TYPES)[number]["id"];

/** @deprecated English names for screens that have not moved to `domain.sourceType` yet. */
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  SEED: "Seeds",
  CUTTING: "Cutting",
  CLONE: "Clone",
  SUBCULTURE: "Subculture / tissue culture",
  RECEIVED: "Received material (external)",
  INTERNAL: "Internal lab stock",
  HARVEST: "Harvest / flower material",
  OTHER: "Other",
};

export type ProvenanceInput = {
  sourceType?: string;
  sourceDescription?: string | null;
  providerOrganizationId?: number | null;
  sourceParentUnitId?: number | null;
};

export type ProvenanceIssueCode =
  "source_type_required" | "source_required" | "source_description_short";

/** The first problem with a material's provenance, as a code the UI translates. */
export function findProvenanceIssue(input: ProvenanceInput): ProvenanceIssueCode | null {
  if (!input.sourceType?.trim()) return "source_type_required";

  const hasProvider = !!input.providerOrganizationId;
  const description = input.sourceDescription?.trim();
  if (hasProvider) return null;
  if (!description) return "source_required";
  if (description.length < 10) return "source_description_short";
  return null;
}

const PROVENANCE_MESSAGES: Record<ProvenanceIssueCode, string> = {
  source_type_required: "Material source type is required",
  source_required:
    "Describe the source (internal stock, older unit, origin) or select an external provider",
  source_description_short:
    "Source description must be at least 10 characters when no provider is listed",
};

export function validateProvenance(input: ProvenanceInput): string | null {
  const issue = findProvenanceIssue(input);
  return issue ? PROVENANCE_MESSAGES[issue] : null;
}

export function validateExperimentInput(body: {
  name?: string;
  startDate?: string;
}): string | null {
  if (!body.name?.trim()) return "Experiment name is required";
  if (!body.startDate) return "Start date is required";
  if (Number.isNaN(new Date(body.startDate).getTime())) return "Invalid date";
  return null;
}

export function validateUnitInput(body: {
  name?: string;
  type?: string;
  experimentId?: number | null;
  cultivarId?: number | null;
  locationId?: number | null;
  sourceType?: string;
  sourceDescription?: string | null;
  providerOrganizationId?: number | null;
  quantity?: number;
}): string | null {
  if (!body.experimentId)
    return "Experiment is required — you must be a responsible member or admin";
  if (!body.cultivarId) return "Cultivar is required";
  if (!body.locationId) return "Location is required";
  if (!body.type) return "Unit type is required";

  const qty = body.quantity ?? 1;
  if (qty < 1 || qty > 50) return "Quantity must be between 1 and 50";

  if (qty === 1 && !body.name?.trim()) return "Unit name is required";
  if (qty > 1 && !body.name?.trim()) return "Base name is required for batch registration";

  const provError = validateProvenance(body);
  if (provError) return provError;

  return null;
}
