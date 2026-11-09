import {
  ArrowRightLeft,
  Biohazard,
  FlaskConical,
  GitFork,
  Lock,
  LockOpen,
  NotebookPen,
  Paperclip,
  PackageCheck,
  Ruler,
  Scissors,
  Sprout,
  Trash2,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { ActionCategory, ActionId } from "@/lib/action-catalog";

/** Icons live here, not in the catalogue, so the catalogue stays pure data. */
export const ACTION_ICONS: Record<ActionId, LucideIcon> = {
  new_experiment: FlaskConical,
  new_sub_experiment: GitFork,
  register_units: Sprout,
  receive_units: PackageCheck,
  derive: Scissors,
  change_stage: TrendingUp,
  measure: Ruler,
  move: ArrowRightLeft,
  ship: Truck,
  place_hold: Lock,
  release_hold: LockOpen,
  destroy: Trash2,
  log_activity: NotebookPen,
  attach_file: Paperclip,
};

export const CATEGORY_ICONS: Record<ActionCategory, LucideIcon> = {
  create: Sprout,
  lifecycle: TrendingUp,
  custody: ArrowRightLeft,
  quality: Biohazard,
  records: NotebookPen,
};
