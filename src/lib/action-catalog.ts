/**
 * The catalogue of things a person can do from the "Take action" launcher, as data: stable keys,
 * where each action is offered and who may use it. It holds no text. The launcher translates
 * `actions.items.<id>.title` and `actions.categories.<id>` from messages/<locale>/actions.json, and
 * picks icons in `components/actions/icons.ts`, so this file stays pure and unit tested.
 *
 * The rules here only decide what to OFFER. The services re-check every permission and state rule
 * on the server; hiding an action is a convenience, never the control.
 */

export const ACTION_CATEGORIES = ["create", "lifecycle", "custody", "quality", "records"] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export const ACTION_SCOPES = ["global", "experiment", "unit"] as const;
export type ActionScope = (typeof ACTION_SCOPES)[number];

export const ACTION_IDS = [
  "new_experiment",
  "new_sub_experiment",
  "register_units",
  "receive_units",
  "derive",
  "change_stage",
  "measure",
  "move",
  "ship",
  "place_hold",
  "release_hold",
  "destroy",
  "log_activity",
  "attach_file",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export const UNIT_TYPES = ["PLANT", "SEEDLOT", "FLOWER", "CULTURE"] as const;
export type UnitTypeKey = (typeof UNIT_TYPES)[number];

/** Who may use an action: anyone signed in, whoever may edit the unit/experiment, or admins only. */
/**
 * `member`: anyone who works on experiments. `editor`: may change the unit or experiment. `quality`:
 * quality assurance on any unit, or an editor. `release`: admins and quality assurance. `admin`.
 */
export type ActionAccess = "member" | "editor" | "quality" | "release" | "admin";

export type ActionDef = {
  id: ActionId;
  category: ActionCategory;
  scopes: readonly ActionScope[];
  access: ActionAccess;
  /** Offered only for these unit types (unit scope). */
  unitTypes?: readonly UnitTypeKey[];
  /** The unit must still be in inventory (not shipped or destroyed). */
  needsActiveUnit?: boolean;
  /** Blocked while the unit is on quality hold (the server refuses it as well). */
  blockedByHold?: boolean;
  /** Offered only while the unit is on hold. */
  needsHold?: boolean;
};

export const ACTIONS: readonly ActionDef[] = [
  { id: "new_experiment", category: "create", scopes: ["global", "experiment"], access: "member" },
  {
    id: "new_sub_experiment",
    category: "create",
    scopes: ["unit"],
    access: "editor",
    needsActiveUnit: true,
  },
  { id: "register_units", category: "create", scopes: ["global", "experiment"], access: "editor" },
  { id: "receive_units", category: "create", scopes: ["global", "experiment"], access: "editor" },
  {
    id: "derive",
    category: "create",
    scopes: ["unit"],
    access: "editor",
    unitTypes: ["PLANT", "CULTURE"],
    needsActiveUnit: true,
    blockedByHold: true,
  },
  {
    id: "change_stage",
    category: "lifecycle",
    scopes: ["unit"],
    access: "editor",
    unitTypes: ["PLANT", "FLOWER"],
    needsActiveUnit: true,
    blockedByHold: true,
  },
  {
    id: "measure",
    category: "lifecycle",
    scopes: ["unit"],
    access: "editor",
    unitTypes: ["PLANT", "FLOWER", "SEEDLOT"],
    needsActiveUnit: true,
  },
  {
    id: "move",
    category: "custody",
    scopes: ["unit"],
    access: "editor",
    needsActiveUnit: true,
    blockedByHold: true,
  },
  {
    id: "ship",
    category: "custody",
    scopes: ["unit"],
    access: "admin",
    needsActiveUnit: true,
    blockedByHold: true,
  },
  {
    id: "place_hold",
    category: "quality",
    scopes: ["unit"],
    access: "quality",
    needsActiveUnit: true,
    blockedByHold: true,
  },
  {
    id: "release_hold",
    category: "quality",
    scopes: ["unit"],
    access: "release",
    needsActiveUnit: true,
    needsHold: true,
  },
  {
    id: "destroy",
    category: "custody",
    scopes: ["unit"],
    access: "editor",
    needsActiveUnit: true,
    blockedByHold: true,
  },
  {
    id: "log_activity",
    category: "records",
    scopes: ["unit"],
    access: "editor",
    needsActiveUnit: true,
  },
  {
    id: "attach_file",
    category: "records",
    scopes: ["unit"],
    access: "editor",
    needsActiveUnit: true,
  },
];

/** Actions whose result cannot be undone: they get an explicit confirmation step. */
export const IRREVERSIBLE_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>([
  "destroy",
  "release_hold",
]);

export function isActionId(value: unknown): value is ActionId {
  return typeof value === "string" && (ACTION_IDS as readonly string[]).includes(value);
}

export function findAction(id: ActionId): ActionDef {
  const def = ACTIONS.find((action) => action.id === id);
  if (!def) throw new Error(`Unknown action: ${id}`);
  return def;
}

export type UnitFacts = {
  type: string;
  /** Mirrors the unit status vocabulary used across the app. */
  status: "active" | "on-hold" | "destroyed";
  /** Everything was shipped: the unit stays on record, but nothing can be done with it. */
  nothingLeft?: boolean;
  /** Whether the signed-in person may change this unit (admin or member of its experiment). */
  canEdit: boolean;
};

export type AvailabilityInput = {
  scope: ActionScope;
  isAdmin: boolean;
  /** Quality assurance (or an admin): holds on any unit. */
  isQuality?: boolean;
  /** An inspector: nothing is offered. */
  readOnly?: boolean;
  /** Experiment scope: whether the person may add to this experiment. */
  canEditExperiment?: boolean;
  /** Global scope: whether the person belongs to at least one experiment. */
  hasExperiments?: boolean;
  unit?: UnitFacts | null;
};

function accessAllows(def: ActionDef, input: AvailabilityInput): boolean {
  if (input.readOnly) return false;
  if (def.access === "member") return true;
  if (def.access === "admin") return input.isAdmin;
  if (def.access === "release") return input.isAdmin || input.isQuality === true;
  if (input.isAdmin) return true;
  if (def.access === "quality" && input.isQuality) return true;
  if (input.scope === "unit") return input.unit?.canEdit === true;
  if (input.scope === "experiment") return input.canEditExperiment === true;
  return input.hasExperiments === true;
}

export function isActionAvailable(def: ActionDef, input: AvailabilityInput): boolean {
  if (!def.scopes.includes(input.scope)) return false;
  if (!accessAllows(def, input)) return false;
  if (input.scope !== "unit") return true;

  const unit = input.unit;
  if (!unit) return false;
  const active = unit.status !== "destroyed" && !unit.nothingLeft;
  const held = unit.status === "on-hold";
  if (def.needsActiveUnit && !active) return false;
  if (def.blockedByHold && held) return false;
  if (def.needsHold && !held) return false;
  if (def.unitTypes && !(def.unitTypes as readonly string[]).includes(unit.type)) return false;
  return true;
}

export function availableActions(input: AvailabilityInput): ActionDef[] {
  return ACTIONS.filter((def) => isActionAvailable(def, input));
}

export type ActionGroup = { category: ActionCategory; actions: ActionDef[] };

/** Groups actions by category in the catalogue's display order; empty categories are dropped. */
export function groupActions(actions: readonly ActionDef[]): ActionGroup[] {
  return ACTION_CATEGORIES.map((category) => ({
    category,
    actions: actions.filter((action) => action.category === category),
  })).filter((group) => group.actions.length > 0);
}

/** Which kinds of derivation a unit type can produce (the service enforces the same rule). */
export const DERIVE_KINDS = ["clone", "cutting", "subculture"] as const;
export type DeriveKind = (typeof DERIVE_KINDS)[number];

export function deriveKindsFor(unitType: string): DeriveKind[] {
  if (unitType === "PLANT") return ["clone", "cutting", "subculture"];
  if (unitType === "CULTURE") return ["subculture"];
  return [];
}

/**
 * Audit action keys written by the services, for screens that show the audit log. The text lives
 * in `actions.audit.<key>`; use `auditActionKey` so an unknown action falls back gracefully.
 */
export const AUDIT_ACTION_KEYS = [
  "create",
  "derive",
  "derive_parent",
  "stage_transition",
  "transfer",
  "activity",
  "attachment",
  "destroy",
  "update",
  "measure",
  "ship",
  "receive",
  "void",
  "lineage",
  "hold",
  "release",
  "lab_test",
  "incident_open",
  "incident_update",
] as const;
export type AuditActionKey = (typeof AUDIT_ACTION_KEYS)[number];

export function auditActionKey(action: string): AuditActionKey | null {
  return (AUDIT_ACTION_KEYS as readonly string[]).includes(action)
    ? (action as AuditActionKey)
    : null;
}

/**
 * @deprecated English strings in a catalogue. Kept only because `activity/page.tsx` and
 * `lib/reports/activity-audit.ts` still import it; they should translate `actions.audit.<key>`
 * (see `auditActionKey`) and this export should then be deleted.
 */
export const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  derive: "Derived",
  derive_parent: "Produced child",
  stage_transition: "Stage change",
  transfer: "Transfer",
  activity: "Activity",
  attachment: "Attachment",
  destroy: "Destroyed",
  update: "Updated",
  measure: "Measurement",
  ship: "Shipped",
  receive: "Received",
  void: "Voided",
  lineage: "Lineage",
  hold: "Quality hold",
  release: "Hold released",
  lab_test: "Lab test",
  incident_open: "Incident opened",
  incident_update: "Incident updated",
};
