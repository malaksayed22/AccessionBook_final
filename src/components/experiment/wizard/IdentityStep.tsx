"use client";

import { useTranslations } from "next-intl";
import { Banner } from "@/components/ui/Banner";
import { Checkbox, Input, Textarea } from "@/components/ui/FormControls";
import { Field } from "@/components/ui/Field";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { NAME_MAX, NOTES_MAX } from "./wizard-validation";
import type { StepProps } from "./step-props";
import { useIssueMessage } from "./use-issue-message";

/** Step 1: what the experiment is called, when it started, which experiment it belongs to, the notes. */
export function IdentityStep({ state, dispatch, errors, options }: StepProps) {
  const t = useTranslations("experiments.wizard.identity");
  const message = useIssueMessage();

  const toggleMember = (id: number, checked: boolean) =>
    dispatch({
      type: "set",
      patch: {
        memberIds: checked ? [...state.memberIds, id] : state.memberIds.filter((m) => m !== id),
      },
    });

  return (
    <div className="space-y-4">
      {options.parentProblem ? (
        <Banner tone="warning">{t(`parentProblem.${options.parentProblem}`)}</Banner>
      ) : null}
      {options.sourceUnit ? (
        <Banner tone="info">
          {t("sourceUnitNote", {
            unit: options.sourceUnit.name,
            cultivar: options.sourceUnit.cultivarName ?? t("unknownCultivar"),
            location: options.sourceUnit.locationName ?? t("unknownLocation"),
            source: options.sourceUnit.providerOrganizationName ?? t("internalSource"),
          })}
        </Banner>
      ) : null}

      <Field label={t("name")} required error={message(errors.name)}>
        {(control) => (
          <Input
            name="name"
            value={state.name}
            maxLength={NAME_MAX}
            autoComplete="off"
            placeholder={t("namePlaceholder")}
            onChange={(e) => dispatch({ type: "set", patch: { name: e.target.value } })}
            {...control}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("startDate")} required error={message(errors.startDate)}>
          {(control) => (
            <Input
              type="date"
              name="startDate"
              value={state.startDate}
              onChange={(e) => dispatch({ type: "set", patch: { startDate: e.target.value } })}
              {...control}
            />
          )}
        </Field>
        <Field
          label={t("estimatedEnd")}
          hint={t("estimatedEndHint")}
          error={message(errors.estimatedEndDate)}
        >
          {(control) => (
            <Input
              type="date"
              name="estimatedEndDate"
              value={state.estimatedEndDate}
              min={state.startDate || undefined}
              onChange={(e) =>
                dispatch({ type: "set", patch: { estimatedEndDate: e.target.value } })
              }
              {...control}
            />
          )}
        </Field>
      </div>

      <Field label={t("parent")} hint={t("parentHint")} error={message(errors.parentExperimentId)}>
        {(control) => (
          <SearchableSelect
            {...control}
            name="parentExperimentId"
            value={state.parentExperimentId}
            onChange={(parentExperimentId) =>
              dispatch({ type: "set", patch: { parentExperimentId } })
            }
            noneLabel={t("parentNone")}
            noResultsLabel={t("parentNoResults")}
            countLabel={(count) => t("parentResults", { count })}
            options={options.parentOptions.map((experiment) => ({
              value: String(experiment.id),
              label: `${experiment.ecode} — ${experiment.name}`,
            }))}
          />
        )}
      </Field>

      {options.user.admin ? (
        <fieldset className="min-w-0">
          <legend className="text-sm font-medium text-fg">{t("team")}</legend>
          <p className="mt-1 text-sm text-fg-secondary">
            {t("leadNote", { name: options.user.name })}
          </p>
          {options.users.length > 0 ? (
            <div className="mt-2 grid gap-x-4 sm:grid-cols-2">
              {options.users.map((user) => (
                <Checkbox
                  key={user.id}
                  label={user.name}
                  checked={state.memberIds.includes(user.id)}
                  onChange={(e) => toggleMember(user.id, e.target.checked)}
                />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-fg-secondary">{t("noOtherMembers")}</p>
          )}
        </fieldset>
      ) : null}

      <Field label={t("notes")} hint={t("notesHint")} error={message(errors.comment)}>
        {(control) => (
          <Textarea
            name="comment"
            rows={4}
            value={state.comment}
            maxLength={NOTES_MAX + 500}
            placeholder={t("notesPlaceholder")}
            onChange={(e) => dispatch({ type: "set", patch: { comment: e.target.value } })}
            {...control}
          />
        )}
      </Field>
    </div>
  );
}
