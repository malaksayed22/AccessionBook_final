/**
 * Where an audit entry's record lives in the application, or null when it has no page. Pure.
 * Entity types are the ones written by the services (`entityType` in each audit call).
 */
export function auditEntityHref(entityType: string, entityId: number): string | null {
  if (!Number.isInteger(entityId) || entityId <= 0) return null;
  switch (entityType) {
    case "unit":
      return `/inventory/units/${entityId}`;
    case "experiment":
      return `/inventory/experiments/${entityId}`;
    case "member":
      return `/records/members/${entityId}`;
    case "organization":
      return `/records/organizations/${entityId}`;
    case "shipment":
      return `/inventory/materials/${entityId}`;
    case "cultivar":
      return `/records/cultivars/${entityId}`;
    case "location":
      return `/records/locations/${entityId}`;
    case "incident":
      return `/quality/incidents/${entityId}`;
    case "task":
      return "/inventory/tasks";
    case "sop":
      return `/quality/sops/${entityId}`;
    default:
      return null;
  }
}

/** Entity types and actions the screen has a translation for; others show their raw value. */
export const KNOWN_ENTITY_TYPES = [
  "unit",
  "experiment",
  "member",
  "organization",
  "shipment",
  "incident",
  "cultivar",
  "location",
  "task",
  "sop",
  "auth",
] as const;
export type KnownEntityType = (typeof KNOWN_ENTITY_TYPES)[number];

export const KNOWN_ACTIONS = [
  "create",
  "update",
  "void",
  "derive",
  "derive_parent",
  "lineage",
  "stage_transition",
  "transfer",
  "measure",
  "activity",
  "attachment",
  "destroy",
  "hold",
  "release",
  "lab_test",
  "incident_open",
  "incident_update",
  "ship",
  "invite",
  "invite-revoke",
  "invite-reissue",
  "invite-accept",
  "deactivate",
  "reactivate",
  "profile-update",
  "login",
  "logout",
  "reauth",
  "password-change",
  "password-confirm-failed",
  "mfa-setup-started",
  "mfa-enabled",
  "mfa-disabled",
  "mfa-reset",
  "mfa-recovery-regenerated",
  "mfa-verified",
  "mfa-failed",
  "session-revoked",
  "sessions-revoked",
  "login-failed",
  "login-locked",
  "admin-bootstrap",
  "export",
  "pseudonymise",
  "move",
  "retire",
] as const;
export type KnownAction = (typeof KNOWN_ACTIONS)[number];

export function isKnownEntityType(value: string): value is KnownEntityType {
  return (KNOWN_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isKnownAction(value: string): value is KnownAction {
  return (KNOWN_ACTIONS as readonly string[]).includes(value);
}
