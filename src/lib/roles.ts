/**
 * The roles a person can have, and what each may do beyond a member's work on their own
 * experiments. Pure, so the server rules (`server/authz.ts`) and the screens read the same answers.
 *
 * - ADMIN: everything. Destruction, shipping, people and reference data stay administrators' alone.
 * - REGULAR (member): works on the experiments they belong to, and sees only those.
 * - QA: sees the whole laboratory; places and releases holds, records lab results and incidents,
 *   reads the compliance reports and the audit trail. Does not move or change units.
 * - INVENTORY (inventory manager): sees the whole laboratory, works on every unit (move, weigh,
 *   stage, derive, labels, documents, activities) and manages locations.
 * - INSPECTOR: read-only, for a Health Canada visit: sees the whole laboratory, the compliance
 *   reports, the audit trail and every record, and changes nothing.
 */
export const ROLES = ["ADMIN", "REGULAR", "QA", "INVENTORY", "INSPECTOR"] as const;
export type Role = (typeof ROLES)[number];

type WithRole = { permissions: Role };

const among = (user: WithRole, roles: readonly Role[]) => roles.includes(user.permissions);

export const isAdminRole = (user: WithRole) => user.permissions === "ADMIN";

/** Everyone but a member sees every experiment, unit and shipment. */
export const seesWholeLab = (user: WithRole) => user.permissions !== "REGULAR";

/** The regulatory reports and the audit trail. */
export const canReadCompliance = (user: WithRole) => among(user, ["ADMIN", "QA", "INSPECTOR"]);

/** Quality decisions on any unit: holds (placing and releasing), lab results, incidents. */
export const isQuality = (user: WithRole) => among(user, ["ADMIN", "QA"]);

/** Works on every unit, not only those of their experiments. */
export const worksOnAllUnits = (user: WithRole) => among(user, ["ADMIN", "INVENTORY"]);

export const canManageLocations = (user: WithRole) => among(user, ["ADMIN", "INVENTORY"]);
/** Who records a destruction: administrators, and members on units of their own experiments. */
export const destroysUnits = (user: WithRole) => among(user, ["ADMIN", "REGULAR"]);

/** Changes nothing but what is their own: their sign-in, password and saved views. */
export const isReadOnly = (user: WithRole) => user.permissions === "INSPECTOR";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request is refused because the person is read-only: an inspector may read anything they
 * can see, and change only what is their own: their sign-in (`/api/auth/…`: password, second
 * factor, sessions) and their saved views of lists (`/api/views`).
 */
export function refusedAsReadOnly(user: WithRole, method: string, path: string): boolean {
  return (
    isReadOnly(user) &&
    !READS.has(method.toUpperCase()) &&
    !path.startsWith("/api/auth/") &&
    !path.startsWith("/api/views")
  );
}
