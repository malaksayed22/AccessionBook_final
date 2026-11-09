"use client";

import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Checkbox, Input } from "@/components/ui/FormControls";
import { IconButton } from "@/components/ui/IconButton";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { CALENDAR_DAY_FORMAT } from "@/features/experiment/dates";
import { MAX_UPLOAD_BYTES } from "@/lib/file-types";
import { ACCEPTED_UPLOAD_TYPES, formatFileSize } from "../document-upload";
import { checkCapacity, plannedUnits, toIntakeGroup, type WizardStep } from "./wizard-state";
import type { StepProps } from "./step-props";
import { useIssueMessage } from "./use-issue-message";

/** Step 4: everything that will be recorded, read back before it is written. */
export function ReviewStep({
  state,
  dispatch,
  errors,
  options,
  capacityConflict,
  files,
  onFilesChange,
  onEdit,
}: StepProps & {
  capacityConflict: boolean;
  /** Files to attach to the experiment once it is created (kept by the wizard, never stored in the draft). */
  files: File[];
  onFilesChange: (files: File[]) => void;
  onEdit: (step: WizardStep) => void;
}) {
  const t = useTranslations("experiments.wizard.review");
  const kinds = useTranslations("experiments.wizard.kinds");
  const stages = useTranslations("domain.growthStage");
  const message = useIssueMessage();
  const format = useFormatter();
  const cultivarName = (id: number | null) =>
    options.cultivars.find((c) => c.id === id)?.name ?? t("none");
  const stageName = (stage: string | null) =>
    stage && stages.has(stage as never) ? stages(stage as never) : null;
  /** "10 × Plants · Blue Dream (6), Skunk #1 (4) · Vegetative": what one group will register. */
  const groupSummary = (group: (typeof state.groups)[number]) => {
    const intake = toIntakeGroup(group);
    const cultivars =
      intake.cultivarMode === "MIXED"
        ? (intake.cultivarBreakdown ?? [])
            .map((split) => `${cultivarName(split.cultivarId)} (${split.count})`)
            .join(", ")
        : cultivarName(intake.cultivarId);
    const status =
      intake.statusMode === "MIXED"
        ? (intake.breakdown ?? [])
            .map((split) => `${stageName(split.status) ?? split.status} (${split.count})`)
            .join(", ")
        : stageName(intake.status ?? null);
    return [t("unitCount", { count: intake.quantity, kind: kinds(group.kind) }), cultivars, status]
      .filter(Boolean)
      .join(" · ");
  };

  const total = plannedUnits(state);
  const location = options.locations.find((l) => String(l.id) === state.locationId);
  const capacity = checkCapacity(location, total);
  const overCapacity = capacity.status === "exceeded" || capacityConflict;
  const day = (value: string) => format.dateTime(new Date(value), CALENDAR_DAY_FORMAT);
  const parent = options.parentOptions.find((p) => String(p.id) === state.parentExperimentId);
  const members = options.users.filter((u) => state.memberIds.includes(u.id));
  const supplier = options.organizations.find((o) => String(o.id) === state.providerId);
  const external = state.providerMode === "EXTERNAL";
  const canReceipt = external && total > 0 && Boolean(state.providerId);

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const known = new Set(files.map((file) => `${file.name}:${file.size}`));
    const added = [...picked].filter((file) => !known.has(`${file.name}:${file.size}`));
    onFilesChange([...files, ...added]);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-secondary">{t("intro")}</p>

      <ReviewSection title={t("identity")} onChange={() => onEdit("identity")}>
        <Row label={t("name")}>{state.name.trim()}</Row>
        <Row label={t("started")}>{day(state.startDate)}</Row>
        <Row label={t("estimatedEnd")}>
          {state.estimatedEndDate ? day(state.estimatedEndDate) : t("none")}
        </Row>
        <Row label={t("parent")}>{parent ? `${parent.ecode} — ${parent.name}` : t("noParent")}</Row>
        {options.user.admin ? (
          <Row label={t("team")}>
            {[t("you", { name: options.user.name }), ...members.map((m) => m.name)].join(", ")}
          </Row>
        ) : null}
        <Row label={t("notes")}>{state.comment.trim() || t("none")}</Row>
      </ReviewSection>

      <ReviewSection title={t("units")} onChange={() => onEdit("units")}>
        {state.groups.length === 0 ? (
          <Row label={t("unitTotal")}>{t("noUnits")}</Row>
        ) : (
          <>
            {state.groups.map((group, index) => (
              <Row
                key={group.key}
                label={
                  group.isGroup
                    ? t("unitGroupLabel", { number: index + 1 })
                    : t("unitLabel", { number: index + 1 })
                }
              >
                {groupSummary(group)}
              </Row>
            ))}
            <Row label={t("unitTotal")}>{format.number(total, "count")}</Row>
          </>
        )}
      </ReviewSection>

      <ReviewSection title={t("source")} onChange={() => onEdit("source")}>
        <Row label={t("sourceMode")}>{external ? t("external") : t("internal")}</Row>
        {external ? (
          <Row label={t("supplier")}>{supplier?.name ?? t("none")}</Row>
        ) : (
          <Row label={t("internalDescription")}>{state.sourceDescription.trim() || t("none")}</Row>
        )}
        {total > 0 ? <Row label={t("location")}>{location?.name ?? t("none")}</Row> : null}
      </ReviewSection>

      <Panel>
        <PanelHeader title={t("receiptAndFiles")} headingLevel={3} />
        <PanelBody className="space-y-4">
          {canReceipt ? (
            <div className="space-y-4 rounded-xl border border-border bg-transparent p-4">
              <Checkbox
                label={t("createReceipt")}
                description={t("createReceiptHint")}
                checked={state.createReceipt}
                onChange={(e) =>
                  dispatch({ type: "set", patch: { createReceipt: e.target.checked } })
                }
              />
            </div>
          ) : (
            <p className="text-sm text-fg-secondary">
              {external ? t("receiptNeedsUnits") : t("receiptInternal")}
            </p>
          )}

          <div className="space-y-4">
            <Field
              label={t("files")}
              hint={t("filesHint", { size: formatFileSize(MAX_UPLOAD_BYTES) })}
            >
              {(control) => (
                <Input
                  type="file"
                  multiple
                  accept={ACCEPTED_UPLOAD_TYPES}
                  onChange={(e) => {
                    addFiles(e.target.files);
                    // Picking the same file again must still fire a change.
                    e.target.value = "";
                  }}
                  {...control}
                />
              )}
            </Field>
            {files.length > 0 ? (
              <ul aria-label={t("filesChosen")} className="divide-y divide-border text-sm">
                {files.map((file) => (
                  <li
                    key={`${file.name}:${file.size}`}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <span className="min-w-0 wrap-break-word">
                      {file.name}
                      <span className="text-fg-secondary"> · {formatFileSize(file.size)}</span>
                    </span>
                    <IconButton
                      label={t("removeFile", { name: file.name })}
                      variant="ghost"
                      onClick={() => onFilesChange(files.filter((f) => f !== file))}
                    >
                      <Trash2 />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : null}
            {files.some((file) => file.size > MAX_UPLOAD_BYTES) ? (
              <Banner tone="warning">
                {t("fileTooLarge", { size: formatFileSize(MAX_UPLOAD_BYTES) })}
              </Banner>
            ) : null}
          </div>
        </PanelBody>
      </Panel>

      {overCapacity ? (
        <div className="space-y-3">
          <Banner tone="warning" title={t("capacityTitle")}>
            {capacity.status === "exceeded"
              ? t("capacityBody", {
                  name: location?.name ?? "",
                  planned: capacity.projected,
                  capacity: capacity.capacity,
                  occupancy: capacity.occupancy,
                })
              : t("capacityConflictBody")}
          </Banner>
          <Checkbox
            label={t("capacityOverride")}
            description={t("capacityOverrideHint")}
            checked={state.capacityOverride}
            aria-invalid={errors.capacityOverride ? true : undefined}
            onChange={(e) =>
              dispatch({ type: "set", patch: { capacityOverride: e.target.checked } })
            }
          />
          {errors.capacityOverride ? (
            <p className="text-sm font-medium text-danger">{message(errors.capacityOverride)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReviewSection({
  title,
  onChange,
  children,
}: {
  title: string;
  onChange: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("experiments.wizard.review");
  return (
    <Panel>
      <PanelHeader
        title={title}
        headingLevel={3}
        actions={
          <Button variant="ghost" size="sm" onClick={onChange}>
            {t("change")}
            <span className="sr-only"> {title}</span>
          </Button>
        }
      />
      <PanelBody>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr] sm:gap-y-3">{children}</dl>
      </PanelBody>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="mt-2 text-fg-secondary first:mt-0 sm:mt-0">{label}</dt>
      <dd className="min-w-0 wrap-break-word text-fg">{children}</dd>
    </>
  );
}
