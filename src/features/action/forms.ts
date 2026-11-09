/**
 * Pure form logic for the launcher: what each action's form holds, how it is validated and the exact
 * request body it produces for the existing API routes. No React, no I/O, so it is unit tested.
 *
 * Validation here is a convenience (instant, field-level, translated); the server schemas remain the
 * authority and always run. Rules mirror them, and where they differ the stricter side is used (for
 * example a reason of at least 10 characters for anything a regulator may read).
 */

export type IssueCode =
  | "required"
  | "invalid"
  | "tooShort"
  | "range"
  | "mismatch"
  | "future"
  | "unchanged"
  | "atLeastOne";

export type FieldIssue = { code: IssueCode; min?: number; max?: number };
export type Issues<K extends string> = Partial<Record<K, FieldIssue>>;
export type BuildResult<P, K extends string> =
  { ok: true; payload: P } | { ok: false; issues: Issues<K> };

export const MIN_REASON_LENGTH = 10;
/** Same threshold as the server's provenance rule (lib/provenance.ts): a bare "n/a" is not a source. */
export const MIN_SOURCE_DESCRIPTION = 10;
export const MAX_BATCH = 50;

export const REGISTER_SOURCE_TYPES = [
  "SEED",
  "CUTTING",
  "CLONE",
  "SUBCULTURE",
  "INTERNAL",
  "HARVEST",
  "OTHER",
] as const;

/** Stages a plant or flower can be moved to (the server also refuses the stage it is already in). */
export const STAGE_CHOICES = [
  "VEGETATIVE",
  "FLOWERING",
  "HARVESTED",
  "DRYING",
  "CURING",
  "STORAGE",
  "SEED",
] as const;

export const ACTIVITY_TYPE_CHOICES = [
  "NUTRIENT",
  "FERTIGATION",
  "FOLIAR",
  "PESTICIDE",
  "BENEFICIAL_INSECTS",
  "SCOUTING",
  "PRUNING",
  "FLUSH",
  "GROW_MEDIA",
  "METRICS",
  "POTENCY",
  "TREATMENT",
  "ENVIRONMENT",
] as const;

export const ATTACHMENT_CATEGORY_CHOICES = ["PHOTO", "PROTOCOL", "QC", "COA", "MANIFEST"] as const;

export const UNIT_TYPE_CHOICES = ["PLANT", "SEEDLOT", "FLOWER", "CULTURE"] as const;

const required: FieldIssue = { code: "required" };

// --- Parsing helpers ------------------------------------------------------------------------------

export function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim() === "";
}

/** A positive id from a `<select>` value; null when nothing is chosen. */
export function parseId(value: string | undefined): number | null {
  if (isBlank(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Decimal number; accepts a comma as the decimal separator (French keyboards). Null when empty/invalid. */
export function parseDecimal(value: string | undefined): number | null {
  if (isBlank(value)) return null;
  const n = Number(value!.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseCount(value: string | undefined): number | null {
  const n = parseDecimal(value);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** Today as `YYYY-MM-DD` in the browser's zone (what `<input type="date">` uses). */
export function todayKey(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** The server resolves "today" to the current moment; only a different day is sent explicitly. */
export function effectiveDate(date: string | undefined, today: string): string | undefined {
  return isBlank(date) || date === today ? undefined : date!.trim();
}

function checkDate(date: string, today: string): FieldIssue | null {
  if (isBlank(date)) return required;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { code: "invalid" };
  return date > today ? { code: "future" } : null;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function checkReason(value: string, min: number = MIN_REASON_LENGTH): FieldIssue | null {
  if (isBlank(value)) return required;
  return value.trim().length < min ? { code: "tooShort", min } : null;
}

function checkQuantity(value: string): FieldIssue | null {
  if (isBlank(value)) return required;
  const n = parseCount(value);
  if (n === null) return { code: "invalid" };
  return n < 1 || n > MAX_BATCH ? { code: "range", min: 1, max: MAX_BATCH } : null;
}

function checkNonNegative(value: string): FieldIssue | null {
  const n = parseDecimal(value);
  if (n === null) return { code: "invalid" };
  return n < 0 ? { code: "range", min: 0 } : null;
}

function finish<P, K extends string>(issues: Issues<K>, payload: () => P): BuildResult<P, K> {
  return Object.keys(issues).length > 0 ? { ok: false, issues } : { ok: true, payload: payload() };
}

// --- Register / receive units ---------------------------------------------------------------------

export type RegisterValues = {
  experimentId: string;
  name: string;
  quantity: string;
  type: string;
  cultivarId: string;
  locationId: string;
  growthStage: string;
  seedCount: string;
  /** Plants in each plant unit (a plant group); empty for one plant. */
  plantCount?: string;
  humidWeight: string;
  dryWeight: string;
  sourceType: string;
  sourceDescription: string;
  providerOrganizationId: string;
  comment: string;
};
export type RegisterKey = keyof RegisterValues;

export function initialRegisterValues(experimentId?: number | null): RegisterValues {
  return {
    experimentId: experimentId ? String(experimentId) : "",
    name: "",
    quantity: "1",
    type: "PLANT",
    cultivarId: "",
    locationId: "",
    growthStage: "VEGETATIVE",
    seedCount: "",
    humidWeight: "",
    dryWeight: "",
    sourceType: "SEED",
    sourceDescription: "",
    providerOrganizationId: "",
    comment: "",
  };
}

/** The "material" step of the register/receive flow: what is being added and where it goes. */
export function validateRegisterMaterial(values: RegisterValues): Issues<RegisterKey> {
  const issues: Issues<RegisterKey> = {};
  if (!parseId(values.experimentId)) issues.experimentId = required;
  if (isBlank(values.name)) issues.name = required;
  else if (values.name.trim().length > 120) issues.name = { code: "range", max: 120 };
  const quantity = checkQuantity(values.quantity);
  if (quantity) issues.quantity = quantity;
  if (!(UNIT_TYPE_CHOICES as readonly string[]).includes(values.type)) issues.type = required;
  if (!parseId(values.cultivarId)) issues.cultivarId = required;
  if (!parseId(values.locationId)) issues.locationId = required;
  if (
    values.type === "SEEDLOT" &&
    !isBlank(values.seedCount) &&
    parseCount(values.seedCount) === null
  ) {
    issues.seedCount = { code: "invalid" };
  }
  if (
    values.type === "SEEDLOT" &&
    parseCount(values.seedCount) !== null &&
    parseCount(values.seedCount)! < 0
  ) {
    issues.seedCount = { code: "range", min: 0 };
  }
  if (values.type === "PLANT" || values.type === "FLOWER") {
    for (const key of ["humidWeight", "dryWeight"] as const) {
      if (!isBlank(values[key])) {
        const issue = checkNonNegative(values[key]);
        if (issue) issues[key] = issue;
      }
    }
  }
  return issues;
}

/** The "origin" step: where the material came from. `receive` needs a provider organisation. */
export function validateRegisterOrigin(
  values: RegisterValues,
  mode: "register" | "receive"
): Issues<RegisterKey> {
  const issues: Issues<RegisterKey> = {};
  if (mode === "receive") {
    if (!parseId(values.providerOrganizationId)) issues.providerOrganizationId = required;
    return issues;
  }
  if (!(REGISTER_SOURCE_TYPES as readonly string[]).includes(values.sourceType)) {
    issues.sourceType = required;
  }
  if (isBlank(values.sourceDescription)) issues.sourceDescription = required;
  else if (values.sourceDescription.trim().length < MIN_SOURCE_DESCRIPTION) {
    issues.sourceDescription = { code: "tooShort", min: MIN_SOURCE_DESCRIPTION };
  }
  return issues;
}

export type RegisterPayload = {
  type: string;
  name: string;
  quantity: number;
  experimentId: number;
  cultivarId: number;
  locationId: number;
  growthStage?: string;
  seedCount?: number;
  plantCount?: number;
  humidWeight?: number;
  dryWeight?: number;
  sourceType: string;
  sourceDescription?: string;
  providerOrganizationId?: number;
  comment?: string;
};

export function buildRegisterPayload(
  values: RegisterValues,
  mode: "register" | "receive"
): BuildResult<RegisterPayload, RegisterKey> {
  const issues = {
    ...validateRegisterMaterial(values),
    ...validateRegisterOrigin(values, mode),
  };
  return finish(issues, () => {
    const weighed = values.type === "PLANT" || values.type === "FLOWER";
    const payload: RegisterPayload = {
      type: values.type,
      name: values.name.trim(),
      quantity: parseCount(values.quantity)!,
      experimentId: parseId(values.experimentId)!,
      cultivarId: parseId(values.cultivarId)!,
      locationId: parseId(values.locationId)!,
      sourceType: mode === "receive" ? "RECEIVED" : values.sourceType,
      comment: trimmed(values.comment),
    };
    if (weighed && values.growthStage) payload.growthStage = values.growthStage;
    if (values.type === "SEEDLOT" && parseCount(values.seedCount) !== null) {
      payload.seedCount = parseCount(values.seedCount)!;
    }
    const plants = parseCount(values.plantCount ?? "");
    if (values.type === "PLANT" && plants !== null && plants > 1) payload.plantCount = plants;
    if (weighed) {
      if (parseDecimal(values.humidWeight) !== null)
        payload.humidWeight = parseDecimal(values.humidWeight)!;
      if (parseDecimal(values.dryWeight) !== null)
        payload.dryWeight = parseDecimal(values.dryWeight)!;
    }
    if (mode === "receive") {
      payload.providerOrganizationId = parseId(values.providerOrganizationId)!;
      payload.sourceDescription = trimmed(values.sourceDescription);
    } else {
      payload.sourceDescription = values.sourceDescription.trim();
    }
    return payload;
  });
}

/** Names the registered batch would get, for the review line: `BASE` or `BASE-1 … BASE-n`. */
export function previewNames(name: string, quantity: number): string[] {
  const base = name.trim();
  if (!base) return [];
  if (quantity <= 1) return [base];
  return [`${base}-1`, `${base}-${quantity}`];
}

// --- Derive ---------------------------------------------------------------------------------------

export type DeriveValues = {
  deriveType: string;
  experimentId: string;
  name: string;
  quantity: string;
  locationId: string;
  growthStage: string;
  comment: string;
};
export type DeriveKey = keyof DeriveValues;

export function initialDeriveValues(
  kinds: readonly string[],
  experimentId?: number | null
): DeriveValues {
  return {
    deriveType: kinds[0] ?? "",
    experimentId: experimentId ? String(experimentId) : "",
    name: "",
    quantity: "1",
    locationId: "",
    growthStage: "",
    comment: "",
  };
}

export type DerivePayload = {
  deriveType: string;
  quantity: number;
  experimentId: number;
  name?: string;
  locationId?: number;
  growthStage?: string;
  comment?: string;
};

export function buildDerivePayload(values: DeriveValues): BuildResult<DerivePayload, DeriveKey> {
  const issues: Issues<DeriveKey> = {};
  if (isBlank(values.deriveType)) issues.deriveType = required;
  if (!parseId(values.experimentId)) issues.experimentId = required;
  const quantity = checkQuantity(values.quantity);
  if (quantity) issues.quantity = quantity;
  if (!isBlank(values.name) && values.name.trim().length > 120) {
    issues.name = { code: "range", max: 120 };
  }
  return finish(issues, () => {
    const payload: DerivePayload = {
      deriveType: values.deriveType,
      quantity: parseCount(values.quantity)!,
      experimentId: parseId(values.experimentId)!,
      name: trimmed(values.name),
      locationId: parseId(values.locationId) ?? undefined,
      comment: trimmed(values.comment),
    };
    if (values.deriveType !== "subculture" && values.growthStage) {
      payload.growthStage = values.growthStage;
    }
    return payload;
  });
}

// --- Move ------------------------------------------------------------------------------------------

export type MoveValues = { toLocationId: string; barcode: string; comment: string };
export type MoveKey = keyof MoveValues;

export function buildMovePayload(
  values: MoveValues,
  unit: { name: string; locationId: number | null }
): BuildResult<{ toLocationId: number; barcode: string; comment?: string }, MoveKey> {
  const issues: Issues<MoveKey> = {};
  const to = parseId(values.toLocationId);
  if (!to) issues.toLocationId = required;
  else if (to === unit.locationId) issues.toLocationId = { code: "unchanged" };
  if (isBlank(values.barcode)) issues.barcode = required;
  // The barcode of a unit is its name (lib/unit-codes.ts); the server compares the same way.
  else if (values.barcode.trim() !== unit.name) issues.barcode = { code: "mismatch" };
  return finish(issues, () => ({
    toLocationId: to!,
    barcode: values.barcode.trim(),
    comment: trimmed(values.comment),
  }));
}

// --- Change stage -------------------------------------------------------------------------------

export type StageValues = { toStage: string; date: string; comment: string };
export type StageKey = keyof StageValues;

export function buildStagePayload(
  values: StageValues,
  unit: { growthStage: string | null },
  today: string
): BuildResult<{ toStage: string; effectiveAt?: string; comment?: string }, StageKey> {
  const issues: Issues<StageKey> = {};
  if (!(STAGE_CHOICES as readonly string[]).includes(values.toStage)) issues.toStage = required;
  else if (values.toStage === unit.growthStage) issues.toStage = { code: "unchanged" };
  const date = checkDate(values.date, today);
  if (date) issues.date = date;
  return finish(issues, () => ({
    toStage: values.toStage,
    effectiveAt: effectiveDate(values.date, today),
    comment: trimmed(values.comment),
  }));
}

// --- Measure -----------------------------------------------------------------------------------------

export type MeasureValues = {
  humidWeight: string;
  dryWeight: string;
  seedCount: string;
  date: string;
  comment: string;
};
export type MeasureKey = keyof MeasureValues | "any";

export function buildMeasurePayload(
  values: MeasureValues,
  unitType: string,
  today: string
): BuildResult<
  {
    humidWeight?: number;
    dryWeight?: number;
    seedCount?: number;
    effectiveAt?: string;
    comment?: string;
  },
  MeasureKey
> {
  const issues: Issues<MeasureKey> = {};
  const weighs = unitType === "PLANT" || unitType === "FLOWER";
  const counts = unitType === "SEEDLOT";
  let entered = 0;

  if (weighs) {
    for (const key of ["humidWeight", "dryWeight"] as const) {
      if (isBlank(values[key])) continue;
      entered += 1;
      const issue = checkNonNegative(values[key]);
      if (issue) issues[key] = issue;
    }
  }
  if (counts && !isBlank(values.seedCount)) {
    entered += 1;
    const n = parseCount(values.seedCount);
    if (n === null) issues.seedCount = { code: "invalid" };
    else if (n < 0) issues.seedCount = { code: "range", min: 0 };
  }
  if (entered === 0) issues.any = { code: "atLeastOne" };
  const date = checkDate(values.date, today);
  if (date) issues.date = date;

  return finish(issues, () => ({
    humidWeight: weighs ? (parseDecimal(values.humidWeight) ?? undefined) : undefined,
    dryWeight: weighs ? (parseDecimal(values.dryWeight) ?? undefined) : undefined,
    seedCount: counts ? (parseCount(values.seedCount) ?? undefined) : undefined,
    effectiveAt: effectiveDate(values.date, today),
    comment: trimmed(values.comment),
  }));
}

// --- Holds ---------------------------------------------------------------------------------------------

export type HoldValues = { reason: string };
export type HoldKey = keyof HoldValues;

export function buildPlaceHoldPayload(
  values: HoldValues
): BuildResult<{ action: "hold"; kind: "HOLD"; reason: string }, HoldKey> {
  const issues: Issues<HoldKey> = {};
  const reason = checkReason(values.reason);
  if (reason) issues.reason = reason;
  return finish(issues, () => ({
    action: "hold" as const,
    kind: "HOLD" as const,
    reason: values.reason.trim(),
  }));
}

export function buildReleaseHoldPayload(reason: string): { action: "release"; reason: string } {
  return { action: "release", reason: reason.trim() };
}

// --- Destroy --------------------------------------------------------------------------------------------

export type DestroyValues = { date: string };
export type DestroyKey = keyof DestroyValues;

/** Step one of destruction (when); the reason and typed phrase come from the confirmation. */
export function validateDestroyDetails(values: DestroyValues, today: string): Issues<DestroyKey> {
  const issues: Issues<DestroyKey> = {};
  const date = checkDate(values.date, today);
  if (date) issues.date = date;
  return issues;
}

export function buildDestroyPayload(
  values: DestroyValues,
  reason: string,
  today: string
): { reason: string; effectiveAt?: string } {
  return {
    reason: reason.trim(),
    effectiveAt: effectiveDate(values.date, today),
  };
}

// --- Ship ---------------------------------------------------------------------------------------------------

/** Material class a unit is shipped as (mirrors lib/materials.ts `materialClassForUnitType`). */
export function shippingMaterial(unitType: string): "SEED" | "FLOWER" | "CULTURE" | "PLANT" {
  switch (unitType) {
    case "SEEDLOT":
      return "SEED";
    case "FLOWER":
      return "FLOWER";
    case "CULTURE":
      return "CULTURE";
    default:
      return "PLANT";
  }
}

export type ShipValues = {
  organizationId: string;
  quantity: string;
  moisture: string;
  trackingNumber: string;
  licenceNumber: string;
  comment: string;
  dispatchNow: boolean;
};
export type ShipKey = keyof ShipValues;

export function initialShipValues(unit: {
  type: string;
  seedCount: number | null;
  humidWeight: number | null;
  dryWeight: number | null;
}): ShipValues {
  const material = shippingMaterial(unit.type);
  let quantity = "1";
  let moisture = "";
  if (material === "SEED") quantity = unit.seedCount !== null ? String(unit.seedCount) : "";
  if (material === "FLOWER") {
    const dry = unit.dryWeight !== null;
    quantity = String(dry ? unit.dryWeight : (unit.humidWeight ?? ""));
    moisture = dry ? "DRY" : unit.humidWeight !== null ? "WET" : "";
  }
  return {
    organizationId: "",
    quantity,
    moisture,
    trackingNumber: "",
    licenceNumber: "",
    comment: "",
    dispatchNow: false,
  };
}

export type ShipPayload = {
  direction: "OUTBOUND";
  organizationId: number;
  status: "DRAFT" | "IN_TRANSIT";
  trackingNumber?: string;
  licenceNumber?: string;
  comment?: string;
  items: Array<{
    unitId: number;
    description: string;
    materialType: string;
    unitCount?: number;
    weightGrams?: number;
    moisture?: string;
  }>;
};

export function buildShipPayload(
  values: ShipValues,
  unit: { id: number; name: string; type: string }
): BuildResult<ShipPayload, ShipKey> {
  const issues: Issues<ShipKey> = {};
  const material = shippingMaterial(unit.type);
  const weighed = material === "FLOWER";
  if (!parseId(values.organizationId)) issues.organizationId = required;

  if (weighed) {
    if (isBlank(values.quantity)) issues.quantity = required;
    else {
      const issue = checkNonNegative(values.quantity);
      if (issue) issues.quantity = issue;
    }
    if (values.moisture !== "WET" && values.moisture !== "DRY") issues.moisture = required;
  } else if (isBlank(values.quantity)) {
    issues.quantity = required;
  } else {
    const n = parseCount(values.quantity);
    if (n === null) issues.quantity = { code: "invalid" };
    else if (n < 0) issues.quantity = { code: "range", min: 0 };
  }

  return finish(issues, () => ({
    direction: "OUTBOUND" as const,
    organizationId: parseId(values.organizationId)!,
    status: values.dispatchNow ? ("IN_TRANSIT" as const) : ("DRAFT" as const),
    trackingNumber: trimmed(values.trackingNumber),
    licenceNumber: trimmed(values.licenceNumber),
    comment: trimmed(values.comment),
    items: [
      {
        unitId: unit.id,
        description: unit.name,
        materialType: material,
        ...(weighed
          ? { weightGrams: parseDecimal(values.quantity)!, moisture: values.moisture }
          : { unitCount: parseCount(values.quantity)! }),
      },
    ],
  }));
}

// --- Log activity -----------------------------------------------------------------------------------------

export type ActivityValues = {
  type: string;
  title: string;
  details: string;
  product?: string;
  pcpNumber?: string;
  amount?: string;
  amountUnit?: string;
  method?: string;
};
export type ActivityKey = keyof ActivityValues;

/** A pesticide is logged with its product, PCP registration number and amount; insects with theirs. */
export function buildActivityPayload(values: ActivityValues): BuildResult<
  {
    type: string;
    title: string;
    details?: string;
    product?: string;
    pcpNumber?: string;
    amount?: number;
    amountUnit?: string;
    method?: string;
  },
  ActivityKey
> {
  const issues: Issues<ActivityKey> = {};
  if (!(ACTIVITY_TYPE_CHOICES as readonly string[]).includes(values.type)) issues.type = required;
  if (isBlank(values.title)) issues.title = required;
  else if (values.title.trim().length > 200) issues.title = { code: "range", max: 200 };
  const needsProduct = values.type === "PESTICIDE" || values.type === "BENEFICIAL_INSECTS";
  if (needsProduct && isBlank(values.product)) issues.product = required;
  if (values.type === "PESTICIDE" && isBlank(values.pcpNumber)) issues.pcpNumber = required;
  const amount = isBlank(values.amount) ? null : parseDecimal(values.amount!);
  if (isBlank(values.amount)) {
    if (needsProduct) issues.amount = required;
  } else if (amount === null) issues.amount = { code: "invalid" };
  else if (amount <= 0) issues.amount = { code: "range", min: 0 };
  if (amount !== null && isBlank(values.amountUnit)) issues.amountUnit = required;
  return finish(issues, () => ({
    type: values.type,
    title: values.title.trim(),
    details: trimmed(values.details),
    product: trimmed(values.product),
    pcpNumber: values.type === "PESTICIDE" ? trimmed(values.pcpNumber) : undefined,
    amount: amount ?? undefined,
    amountUnit: amount === null ? undefined : trimmed(values.amountUnit),
    method: trimmed(values.method),
  }));
}

// --- Attach file ----------------------------------------------------------------------------------------------

export type AttachValues = { category: string; label: string };
export type AttachKey = keyof AttachValues | "file";

export function validateAttachment(
  values: AttachValues,
  file: { size: number } | null,
  maxBytes: number
): Issues<AttachKey> {
  const issues: Issues<AttachKey> = {};
  if (!(ATTACHMENT_CATEGORY_CHOICES as readonly string[]).includes(values.category)) {
    issues.category = required;
  }
  if (isBlank(values.label)) issues.label = required;
  else if (values.label.trim().length > 200) issues.label = { code: "range", max: 200 };
  if (!file || file.size === 0) issues.file = required;
  else if (file.size > maxBytes) issues.file = { code: "range", max: maxBytes };
  return issues;
}
