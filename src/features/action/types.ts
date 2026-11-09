/** Shapes shared by the action bootstrap endpoint and the launcher. Pure types: safe in the browser. */
import type { UnitFacts } from "@/lib/action-catalog";
import type { Role } from "@/lib/roles";

export type ActionUnit = UnitFacts & {
  id: number;
  name: string;
  experimentId: number | null;
  /** "HOLD" while a hold is active. */
  holdKind: "HOLD" | null;
  locationId: number | null;
  growthStage: string | null;
  /** Last recorded measurements (grams and seed count), used to prefill the shipping line. */
  humidWeight: number | null;
  dryWeight: number | null;
  seedCount: number | null;
};

export type ActionLocation = {
  id: number;
  name: string;
  capacity: number | null;
  occupancy: number;
};

export type ActionBootstrap = {
  user: { id: number; name: string; permissions: Role };
  experiments: Array<{ id: number; ecode: string; name: string }>;
  cultivars: Array<{ id: number; name: string }>;
  locations: ActionLocation[];
  organizations: Array<{ id: number; name: string }>;
  /** Admins only: every active member (the experiment form uses it to add members). */
  users: Array<{ id: number; name: string }>;
  /** Present when the request named a unit the person may see. */
  unit: ActionUnit | null;
};
