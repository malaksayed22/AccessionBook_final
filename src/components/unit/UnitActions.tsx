"use client";

import {
  ArrowRightLeft,
  ChevronDown,
  CirclePause,
  CirclePlay,
  FileDown,
  FileText,
  FlaskConical,
  GitBranchPlus,
  Link2,
  Pencil,
  Merge,
  Printer,
  Recycle,
  Scale,
  ShieldAlert,
  Split,
  Sprout,
  TestTube,
  Trash2,
  TriangleAlert,
  Truck,
  Upload,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PrintLabelButton, type PrintLabelHandle } from "@/components/PrintLabelButton";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { Link, useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";
import type { ActionAvailability, UnitActionId } from "@/lib/unit-actions";
import type { ActionUnit, Option } from "./action-types";
import {
  DeriveDialog,
  DestroyDialog,
  EditDetailsDialog,
  EditDialog,
  LinkParentDialog,
  MeasureDialog,
  MoveDialog,
  MergeDialog,
  SplitDialog,
  StageDialog,
  WasteDialog,
} from "./unit-event-dialogs";
import {
  HoldDialog,
  IncidentDialog,
  SampleDialog,
  TissueSampleDialog,
  TestDialog,
  UploadDialog,
} from "./unit-record-dialogs";

/*
 * One place that knows which actions this user may take on this unit right now (decided on the
 * server by `availabilityMap`, from the same rules the services enforce) and opens the matching
 * form. Buttons anywhere in the page open an action through `ActionButton`; the Actions menu at
 * the top of the page lists them all. The server still checks every request, so a stale page can never do more
 * than allowed.
 */
type ActionsContext = {
  unit: ActionUnit;
  /** `opener` is the control to give focus back to when the form closes. */
  open: (action: UnitActionId, opener?: HTMLElement | null) => void;
  availability: Record<UnitActionId, ActionAvailability>;
};
const Context = createContext<ActionsContext | null>(null);

function useActions(): ActionsContext {
  const value = useContext(Context);
  if (!value) throw new Error("UnitActions components must be rendered inside UnitActionsProvider");
  return value;
}

const ICONS: Record<UnitActionId, LucideIcon> = {
  move: ArrowRightLeft,
  stage: Sprout,
  measure: Scale,
  waste: Recycle,
  split: Split,
  merge: Merge,
  ship: Truck,
  derive: GitBranchPlus,
  edit: Pencil,
  editDetails: Pencil,
  linkParent: Link2,
  hold: CirclePause,
  releaseHold: CirclePlay,
  destroy: Trash2,
  recordTest: FlaskConical,
  sample: TestTube,
  reportIncident: TriangleAlert,
  reportWeight: Scale,
  upload: Upload,
};

export function UnitActionsProvider({
  unit,
  availability,
  locations,
  canAddLocation = false,
  children,
}: {
  unit: ActionUnit;
  availability: Record<UnitActionId, ActionAvailability>;
  locations: Option[];
  /** Administrators can add a location from the move form. */
  canAddLocation?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [active, setActive] = useState<UnitActionId | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setActive(null);
    // The form is not a child of its opener, so the dialog cannot restore focus by itself.
    const target = opener.current;
    opener.current = null;
    setTimeout(() => {
      if (target?.isConnected) target.focus();
      else document.querySelector<HTMLElement>("main h1")?.focus();
    }, 0);
  }, []);
  const open = useCallback(
    (action: UnitActionId, from?: HTMLElement | null) => {
      if (availability[action].status !== "allowed") return;
      // Shipping is a whole movement record (organization, dates, other lines): it opens the
      // movement form with this unit as its first line instead of a dialog.
      if (action === "ship") {
        router.push(`/inventory/materials/new?unit=${unit.id}`);
        return;
      }
      opener.current = from ?? null;
      setActive(action);
    },
    [availability, router, unit.id]
  );
  const value = useMemo(() => ({ open, availability, unit }), [open, availability, unit]);

  const dialog = (() => {
    switch (active) {
      case "move":
        return (
          <MoveDialog
            unit={unit}
            locations={locations}
            canAddLocation={canAddLocation}
            onClose={close}
          />
        );
      case "stage":
        return <StageDialog unit={unit} onClose={close} />;
      case "measure":
        return <MeasureDialog unit={unit} onClose={close} />;
      case "waste":
        return <WasteDialog unit={unit} onClose={close} />;
      case "split":
        return <SplitDialog unit={unit} locations={locations} onClose={close} />;
      case "merge":
        return <MergeDialog unit={unit} onClose={close} />;
      case "derive":
        return <DeriveDialog unit={unit} locations={locations} onClose={close} />;
      case "edit":
        return <EditDialog unit={unit} onClose={close} />;
      case "editDetails":
        return (
          <EditDetailsDialog
            unit={unit}
            canChangeStage={availability.stage.status === "allowed"}
            onClose={close}
          />
        );
      case "linkParent":
        return <LinkParentDialog unit={unit} onClose={close} />;
      case "hold":
        return <HoldDialog unit={unit} onClose={close} />;
      case "releaseHold":
        return <ReleaseHoldDialog unit={unit} onClose={close} />;
      case "destroy":
        return <DestroyDialog unit={unit} onClose={close} />;
      case "recordTest":
        return <TestDialog unit={unit} onClose={close} />;
      case "sample":
        return unit.type === "PLANT" || unit.type === "CULTURE" ? (
          <TissueSampleDialog unit={unit} onClose={close} />
        ) : (
          <SampleDialog unit={unit} onClose={close} />
        );
      case "reportIncident":
        return <IncidentDialog unit={unit} onClose={close} />;
      case "reportWeight":
        return <IncidentDialog unit={unit} weightMistake onClose={close} />;
      case "upload":
        return <UploadDialog unit={unit} onClose={close} />;
      default:
        return null;
    }
  })();

  return (
    <Context.Provider value={value}>
      {children}
      {dialog}
    </Context.Provider>
  );
}

/** Releasing a hold re-opens movement of regulated material: reason required, password re-checked. */
function ReleaseHoldDialog({ unit, onClose }: { unit: ActionUnit; onClose: () => void }) {
  const t = useTranslations("units.actions.releaseHold");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const networkError = useNetworkError();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const release = async (reason: string) => {
    setPending(true);
    setError(null);
    const result = await sendJson(`/api/units/${unit.id}/hold`, { action: "release", reason });
    setPending(false);
    if (!result.ok) {
      setError(result.network ? networkError : apiError(result.error));
      return;
    }
    toast({ tone: "success", title: t("success", { name: unit.name }) });
    onClose();
    router.refresh();
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("title", { name: unit.name })}
      description={t("description")}
      confirmLabel={t("confirm")}
      tone="primary"
      requireReason
      reasonLabel={t("reason")}
      reasonHint={t("reasonHint")}
      reasonMinLength={10}
      pending={pending}
      error={error}
      onConfirm={({ reason }) => {
        void release(reason);
      }}
    />
  );
}

type ActionButtonProps = {
  action: UnitActionId;
  children?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
};

/** Opens an action's form. Renders nothing when the user may never do it here. */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  ...rest
}: ActionButtonProps) {
  const t = useTranslations("units.actions.menu");
  const { open, availability } = useActions();
  const state = availability[action];
  if (state.status === "hidden") return null;
  const Icon = ICONS[action];
  return (
    <Button
      variant={variant}
      icon={<Icon />}
      disabled={state.status === "blocked"}
      onClick={(event) => open(action, event.currentTarget)}
      {...rest}
    >
      {children ?? t(action)}
    </Button>
  );
}

/** The menu's groups, in order; destruction comes last. */
const MENU_GROUPS: ReadonlyArray<{
  id: "record" | "quality" | "details";
  actions: readonly UnitActionId[];
}> = [
  {
    id: "record",
    actions: ["move", "stage", "measure", "waste", "derive", "split", "merge", "ship"],
  },
  { id: "quality", actions: ["reportIncident", "reportWeight", "hold", "releaseHold"] },
  { id: "details", actions: ["upload", "editDetails", "edit", "linkParent"] },
];

/** An icon inside a link item, where `MenuItem` cannot add one (`asChild`). */
function LinkIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-4">
      <Icon />
    </span>
  );
}

/** A form in the menu. A blocked one stays, greyed out, with why as its description. */
function ActionItem({
  icon: Icon,
  label,
  note,
  tone,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  note?: string;
  tone?: "danger";
  onSelect: () => void;
}) {
  const labelId = useId();
  const noteId = useId();
  return (
    <MenuItem
      icon={<Icon />}
      tone={tone}
      disabled={note !== undefined}
      aria-labelledby={labelId}
      aria-describedby={note ? noteId : undefined}
      onSelect={onSelect}
    >
      <span id={labelId}>{label}</span>
      {note ? (
        <span id={noteId} className="ms-auto ps-3 text-xs text-fg-tertiary">
          {note}
        </span>
      ) : null}
    </MenuItem>
  );
}

/** What the menu calls an action, where it depends on the unit. */
function actionLabelKey(action: UnitActionId, unit: ActionUnit) {
  if (action !== "measure") return `menu.${action}` as const;
  return unit.type === "SEEDLOT" ? ("menu.recordSeeds" as const) : ("menu.addWeight" as const);
}

/**
 * Every form on the unit in one "Actions" menu at the top right of the page, grouped, with
 * destruction last, in red. An action a hold blocks, or a weight already on record, stays in the
 * menu, greyed out, saying why. A unit that is not active (destroyed, or nothing left in stock) takes
 * no more actions: the button is disabled, and the banner says why.
 */
export function ActionsMenu() {
  const t = useTranslations("units.actions");
  const { open, availability, unit } = useActions();
  const trigger = useRef<HTMLButtonElement>(null);
  const notActive = unit.terminal !== null;

  const visible = (action: UnitActionId) => {
    // Weights are not added from the menu (a seed lot still records its seed count here).
    if (action === "measure" && unit.type !== "SEEDLOT") return false;
    const state = availability[action];
    return (
      state.status === "allowed" ||
      (state.status === "blocked" && (state.reason === "held" || state.reason === "weighed"))
    );
  };
  const groups = MENU_GROUPS.map((group) => ({
    ...group,
    actions: group.actions.filter(visible),
  })).filter((group) => group.actions.length > 0);
  const item = (action: UnitActionId, tone?: "danger") => {
    const state = availability[action];
    return (
      <ActionItem
        key={action}
        icon={ICONS[action]}
        tone={tone}
        label={t(actionLabelKey(action, unit))}
        note={
          state.status === "blocked"
            ? t(state.reason === "weighed" ? "weighed" : "held")
            : undefined
        }
        onSelect={() => open(action, trigger.current)}
      />
    );
  };

  const button = (
    <Button
      ref={trigger}
      variant="primary"
      icon={<Zap />}
      iconAfter={<ChevronDown />}
      disabled={notActive || (groups.length === 0 && !visible("destroy"))}
      title={notActive ? t("notActive") : undefined}
      className="print:hidden"
    >
      {t("menu.label")}
    </Button>
  );
  if (notActive) return button;

  return (
    <Menu modal={false}>
      <MenuTrigger asChild>{button}</MenuTrigger>
      <MenuContent className="max-h-(--radix-dropdown-menu-content-available-height) min-w-64 overflow-y-auto">
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 ? <MenuSeparator /> : null}
            <MenuLabel>{t(`groups.${group.id}`)}</MenuLabel>
            {group.actions.map((action) => item(action))}
          </Fragment>
        ))}
        {visible("destroy") ? (
          <>
            {groups.length > 0 ? <MenuSeparator /> : null}
            {item("destroy", "danger")}
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

export type UnitLabelInfo = {
  unitTypeLabel: string;
  cultivarName?: string | null;
  profileUrl: string;
  mother?: { id: number; name: string } | null;
};

/** "Print label": prints the unit's label now. */
export function LabelMenu({ label }: { label: UnitLabelInfo }) {
  const printing = useTranslations("units.panels.label");
  const { unit } = useActions();
  const printer = useRef<PrintLabelHandle>(null);

  return (
    <>
      <Button
        variant="secondary"
        icon={<Printer />}
        className="print:hidden"
        onClick={() => printer.current?.print()}
      >
        {printing("print")}
      </Button>
      {/* The label is drawn off screen, ready to print. */}
      <PrintLabelButton
        handle={printer}
        unitId={unit.id}
        unitName={unit.name}
        unitTypeLabel={label.unitTypeLabel}
        cultivarName={label.cultivarName}
        profileUrl={label.profileUrl}
        mother={label.mother}
      />
    </>
  );
}

/**
 * "Records": the recall trace, the audit report and the unit's record as a PDF file. Always
 * available, active or not: the history of a unit is kept after it leaves the inventory.
 */
export function RecordsMenu() {
  const t = useTranslations("units.actions");
  const detail = useTranslations("units.detail");
  const locale = useLocale();
  const { unit } = useActions();

  return (
    <Menu modal={false}>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          icon={<FileText />}
          iconAfter={<ChevronDown />}
          className="print:hidden"
        >
          {t("recordsMenu")}
        </Button>
      </MenuTrigger>
      <MenuContent className="min-w-56">
        <MenuItem asChild>
          <Link href={`/quality/recall?unitId=${unit.id}`}>
            <LinkIcon icon={ShieldAlert} />
            {detail("recallTrace")}
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link href={`/inventory/units/${unit.id}/export`}>
            <LinkIcon icon={FileText} />
            {detail("auditReport")}
          </Link>
        </MenuItem>
        {/* A file from an API route: a plain link, with no language prefix. */}
        <MenuItem asChild>
          <a href={`/api/units/${unit.id}/record?locale=${locale}`} download>
            <LinkIcon icon={FileDown} />
            {detail("recordPdf")}
          </a>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
