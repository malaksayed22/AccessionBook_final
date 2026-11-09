"use client";

import { useTranslations } from "next-intl";
import { Field } from "@/components/ui/Field";
import { Select, Textarea } from "@/components/ui/FormControls";
import { SOURCE_TYPES } from "@/lib/provenance";

type ProvenanceField =
  "sourceType" | "providerOrganizationId" | "sourceDescription" | "sourceParentUnitId";

/**
 * The "where did this material come from" fields shared by the unit registration and receipt forms.
 * The host form owns the values (`form`, a map of text) and the rules (`findProvenanceIssue` in
 * `lib/provenance`); pass translated messages in `errors` to show them next to the field.
 */
export function ProvenanceFields({
  form,
  setField,
  bootstrap,
  errors = {},
}: {
  form: Record<string, string>;
  setField: (key: string, value: string) => void;
  bootstrap: {
    organizations: Array<{ id: number; name: string }>;
    units: Array<{ id: number; name: string; type: string }>;
  } | null;
  errors?: Partial<Record<ProvenanceField, string>>;
}) {
  const t = useTranslations("experiments.provenance");
  const unitType = useTranslations("domain.unitType");
  const hasProvider = !!form.providerOrganizationId;

  return (
    <fieldset className="space-y-4 rounded-xl border border-border bg-transparent p-4">
      <legend className="px-1 text-sm font-semibold text-fg">{t("title")}</legend>
      <p className="text-sm text-fg-secondary">{t("intro")}</p>

      <Field label={t("sourceType")} required error={errors.sourceType}>
        {(control) => (
          <Select
            value={form.sourceType || ""}
            onChange={(e) => setField("sourceType", e.target.value)}
            {...control}
          >
            <option value="">{t("chooseSource")}</option>
            {SOURCE_TYPES.map((s) => (
              <option key={s.id} value={s.id}>
                {t(`sourceTypes.${s.id}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label={t("provider")} error={errors.providerOrganizationId}>
        {(control) => (
          <Select
            value={form.providerOrganizationId || ""}
            onChange={(e) => setField("providerOrganizationId", e.target.value)}
            {...control}
          >
            <option value="">{t("noProvider")}</option>
            {bootstrap?.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {!hasProvider ? (
        <Field
          label={t("sourceDescription")}
          required
          hint={t("descriptionHint")}
          error={errors.sourceDescription}
        >
          {(control) => (
            <Textarea
              rows={3}
              value={form.sourceDescription || ""}
              onChange={(e) => setField("sourceDescription", e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              {...control}
            />
          )}
        </Field>
      ) : null}

      <Field label={t("parentUnit")} error={errors.sourceParentUnitId}>
        {(control) => (
          <Select
            value={form.sourceParentUnitId || ""}
            onChange={(e) => setField("sourceParentUnitId", e.target.value)}
            {...control}
          >
            <option value="">{t("noParentUnit")}</option>
            {bootstrap?.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({unitType(u.type as "PLANT")})
              </option>
            ))}
          </Select>
        )}
      </Field>
    </fieldset>
  );
}
