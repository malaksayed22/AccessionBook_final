import type { UnitProfile } from "@/features/unit/queries";

/** What the action forms need to know about the unit. Plain values only: it crosses to the client. */
export type ActionUnit = {
  id: number;
  name: string;
  type: UnitProfile["type"];
  locationId: number | null;
  growthStage: NonNullable<UnitProfile["current"]>["growthStage"];
  humidWeight: number | null;
  dryWeight: number | null;
  seedCount: number | null;
  /** Plants in a plant group; null means one plant. */
  plantCount: number | null;
  sex: string | null;
  notes: string | null;
  terminal: UnitProfile["terminal"];
  /** The experiment the unit belongs to, for the forms that can put new units elsewhere. */
  experiment: { id: number; ecode: string; name: string } | null;
  /** Tissue samples taken from it, for the lab result form. */
  tissueSamples?: ReadonlyArray<{ id: number; code: string }>;
};

export type Option = { id: number; name: string };

export type DialogProps = { unit: ActionUnit; onClose: () => void };
