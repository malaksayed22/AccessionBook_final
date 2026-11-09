"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/FormControls";
import { IconButton } from "@/components/ui/IconButton";
import { Panel, PanelBody } from "@/components/ui/Panel";
import { INTAKE_KINDS, findIntakeKind } from "@/lib/experiment-intake";
import { InlineError } from "./InlineError";
import { NewCultivarForm } from "./NewCultivarForm";
import { Segmented } from "./Segmented";
import type { UnitGroup } from "./wizard-state";
import type { StepErrors } from "./wizard-validation";
import { useIssueMessage } from "./use-issue-message";

const sum = (counts: Record<string, string>) =>
  Object.values(counts).reduce((total, value) => total + (Number(value) || 0), 0);

/** One group of starting units: what it is, how many, which cultivar(s), which status(es). */
export function UnitGroupEditor({
  group,
  index,
  cultivars,
  canAddCultivar,
  onCultivarAdded,
  errors,
  canRemove,
  onChange,
  onChangeKind,
  onRemove,
}: {
  group: UnitGroup;
  index: number;
  cultivars: ReadonlyArray<{ id: number; name: string }>;
  /** Administrators can add a cultivar to the library from here. */
  canAddCultivar: boolean;
  onCultivarAdded: (cultivar: { id: number; name: string }) => void;
  /** Wizard errors; this group reads its own `groups.<index>.*` entries. */
  errors: StepErrors;
  canRemove: boolean;
  onChange: (patch: Partial<Omit<UnitGroup, "key">>) => void;
  onChangeKind: (kind: UnitGroup["kind"]) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("experiments.wizard.units");
  const kinds = useTranslations("experiments.wizard.kinds");
  const quantityLabels = useTranslations("experiments.wizard.quantityLabels");
  const stages = useTranslations("domain.growthStage");
  const message = useIssueMessage();
  const ids = useId();
  const [addingCultivar, setAddingCultivar] = useState(false);

  const kind = findIntakeKind(group.kind)!;
  const issue = (field: string) => errors[`groups.${index}.${field}`];
  const quantity = Number(group.quantity) || 0;
  const cultivarName = new Map(cultivars.map((c) => [String(c.id), c.name]));
  const unusedCultivars = cultivars.filter((c) => !(String(c.id) in group.cultivarBreakdown));
  const cultivarErrorId = `${ids}-cultivar-error`;
  const statusErrorId = `${ids}-status-error`;

  const setCount = (field: "cultivarBreakdown" | "breakdown", key: string, value: string) =>
    onChange({ [field]: { ...group[field], [key]: value } });
  const cultivarCreated = (cultivar: { id: number; name: string }) => {
    onCultivarAdded(cultivar);
    setAddingCultivar(false);
    if (group.cultivarMode === "SAME") onChange({ cultivarId: String(cultivar.id) });
    else setCount("cultivarBreakdown", String(cultivar.id), "");
  };
  const removeCultivar = (key: string) => {
    const next = { ...group.cultivarBreakdown };
    delete next[key];
    onChange({ cultivarBreakdown: next });
  };

  return (
    <Panel>
      <PanelBody className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-fg">
            {group.isGroup
              ? t("groupTitle", { number: index + 1 })
              : t("unitTitle", { number: index + 1 })}
          </h3>
          {canRemove ? (
            <IconButton
              label={
                group.isGroup
                  ? t("removeGroup", { number: index + 1 })
                  : t("removeUnit", { number: index + 1 })
              }
              variant="ghost"
              onClick={onRemove}
            >
              <Trash2 />
            </IconButton>
          ) : null}
        </div>

        <div className={group.isGroup ? "grid gap-4 sm:grid-cols-2" : undefined}>
          <Field label={t("kind")} required error={message(issue("kind"))}>
            {(control) => (
              <Select
                value={group.kind}
                onChange={(e) => onChangeKind(e.target.value as UnitGroup["kind"])}
                {...control}
              >
                {INTAKE_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {kinds(k.id)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {group.isGroup ? (
            <Field label={quantityLabels(group.kind)} required error={message(issue("quantity"))}>
              {(control) => (
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={group.quantity}
                  onChange={(e) => onChange({ quantity: e.target.value })}
                  {...control}
                />
              )}
            </Field>
          ) : null}
        </div>

        <div className="space-y-4">
          {group.isGroup ? (
            <Segmented
              legend={t("cultivarAssignment")}
              name={`${ids}-cultivar-mode`}
              value={group.cultivarMode}
              options={[
                { value: "SAME", label: t("cultivarSame") },
                { value: "MIXED", label: t("cultivarMixed") },
              ]}
              onChange={(cultivarMode) => onChange({ cultivarMode, cultivarBreakdown: {} })}
            />
          ) : null}
          {!group.isGroup || group.cultivarMode === "SAME" ? (
            <Field label={t("cultivar")} required error={message(issue("cultivar"))}>
              {(control) => (
                <Select
                  value={group.cultivarId}
                  onChange={(e) => onChange({ cultivarId: e.target.value })}
                  {...control}
                >
                  <option value="">{t("chooseCultivar")}</option>
                  {cultivars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <div className="space-y-4">
              {Object.entries(group.cultivarBreakdown).map(([key, value]) => (
                <div key={key} className="flex items-end gap-2">
                  <Field
                    className="flex-1"
                    label={t("cultivarCount", { name: cultivarName.get(key) ?? key })}
                  >
                    {(control) => (
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={value}
                        onChange={(e) => setCount("cultivarBreakdown", key, e.target.value)}
                        {...control}
                      />
                    )}
                  </Field>
                  <IconButton
                    label={t("removeCultivar", { name: cultivarName.get(key) ?? key })}
                    variant="ghost"
                    className="mb-1.5"
                    onClick={() => removeCultivar(key)}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
              <Field label={t("addCultivar")}>
                {(control) => (
                  <Select
                    value=""
                    disabled={unusedCultivars.length === 0}
                    onChange={(e) => {
                      if (e.target.value) setCount("cultivarBreakdown", e.target.value, "");
                    }}
                    {...control}
                    aria-invalid={issue("cultivar") ? true : undefined}
                    aria-describedby={[control["aria-describedby"], cultivarErrorId]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <option value="">{t("chooseCultivar")}</option>
                    {unusedCultivars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <p className="text-sm text-fg-secondary" aria-live="polite">
                {t("assigned", { assigned: sum(group.cultivarBreakdown), quantity })}
              </p>
              <InlineError id={cultivarErrorId}>{message(issue("cultivar"))}</InlineError>
            </div>
          )}
        </div>

        {addingCultivar ? (
          <NewCultivarForm onCreated={cultivarCreated} onCancel={() => setAddingCultivar(false)} />
        ) : canAddCultivar ? (
          <Button variant="secondary" icon={<Plus />} onClick={() => setAddingCultivar(true)}>
            {t("newCultivar")}
          </Button>
        ) : (
          <p className="text-sm text-fg-secondary">{t("cultivarMissingMember")}</p>
        )}

        {kind.tracksSeedCount ? (
          <Field
            label={t("seedsPerLot")}
            hint={t("seedsPerLotHint")}
            error={message(issue("seedsPerLot"))}
          >
            {(control) => (
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={group.seedsPerLot}
                placeholder={t("seedsPerLotPlaceholder")}
                onChange={(e) => onChange({ seedsPerLot: e.target.value })}
                {...control}
              />
            )}
          </Field>
        ) : null}

        {kind.tracksWeight ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("wetWeight")} error={message(issue("wetWeightGrams"))}>
              {(control) => (
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={group.wetWeightGrams}
                  onChange={(e) => onChange({ wetWeightGrams: e.target.value })}
                  {...control}
                />
              )}
            </Field>
            <Field label={t("dryWeight")} error={message(issue("dryWeightGrams"))}>
              {(control) => (
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={group.dryWeightGrams}
                  onChange={(e) => onChange({ dryWeightGrams: e.target.value })}
                  {...control}
                />
              )}
            </Field>
          </div>
        ) : null}

        {kind.stages.length > 0 ? (
          <div className="space-y-4">
            {group.isGroup ? (
              <Segmented
                legend={t("statusAssignment")}
                name={`${ids}-status-mode`}
                value={group.statusMode}
                options={[
                  { value: "SAME", label: t("statusSame") },
                  { value: "MIXED", label: t("statusMixed") },
                ]}
                onChange={(statusMode) => onChange({ statusMode })}
              />
            ) : null}
            {!group.isGroup || group.statusMode === "SAME" ? (
              <Field
                label={group.isGroup ? t("status") : t("startingStatus")}
                required
                error={message(issue("status"))}
              >
                {(control) => (
                  <Select
                    value={group.status}
                    onChange={(e) => onChange({ status: e.target.value })}
                    {...control}
                  >
                    <option value="">{t("chooseStatus")}</option>
                    {kind.stages.map((stage) => (
                      <option key={stage} value={stage}>
                        {stages(stage as "VEGETATIVE")}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {kind.stages.map((stage, position) => (
                    <Field
                      key={stage}
                      label={t("statusCount", { name: stages(stage as "VEGETATIVE") })}
                    >
                      {(control) => (
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={group.breakdown[stage] ?? ""}
                          placeholder="0"
                          onChange={(e) => setCount("breakdown", stage, e.target.value)}
                          {...control}
                          aria-invalid={position === 0 && issue("status") ? true : undefined}
                          aria-describedby={
                            position === 0
                              ? [control["aria-describedby"], statusErrorId]
                                  .filter(Boolean)
                                  .join(" ")
                              : control["aria-describedby"]
                          }
                        />
                      )}
                    </Field>
                  ))}
                </div>
                <p className="text-sm text-fg-secondary" aria-live="polite">
                  {t("assigned", { assigned: sum(group.breakdown), quantity })}
                </p>
                <InlineError id={statusErrorId}>{message(issue("status"))}</InlineError>
              </div>
            )}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
