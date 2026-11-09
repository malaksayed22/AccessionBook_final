"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select, Textarea } from "@/components/ui/FormControls";
import { Link } from "@/i18n/navigation";
import { NewLocationForm } from "./NewLocationForm";
import { Segmented } from "./Segmented";
import { SupplierRegistration } from "./SupplierRegistration";
import { checkCapacity, plannedUnits } from "./wizard-state";
import { SOURCE_DESCRIPTION_MAX } from "./wizard-validation";
import type { StepProps } from "./step-props";
import { useIssueMessage } from "./use-issue-message";

/**
 * Step 3: where the material came from (always required), and, when the experiment starts with
 * units, where they are held.
 */
export function SourceStep({
  state,
  dispatch,
  errors,
  options,
  onSupplierRegistered,
  onLocationAdded,
}: StepProps & {
  onSupplierRegistered: (organization: { id: number; name: string }) => void;
  onLocationAdded: (location: { id: number; name: string; capacity: number | null }) => void;
}) {
  const t = useTranslations("experiments.wizard.source");
  const message = useIssueMessage();
  const [registering, setRegistering] = useState(false);
  const [addingLocation, setAddingLocation] = useState(false);

  const total = plannedUnits(state);
  const hasUnits = total > 0;
  const external = state.providerMode === "EXTERNAL";
  const location = options.locations.find((l) => String(l.id) === state.locationId);
  const capacity = checkCapacity(location, total);

  return (
    <div className="space-y-6">
      <Segmented
        legend={
          <>
            {t("sourceMode")}
            <span aria-hidden="true" className="ms-0.5 text-danger">
              *
            </span>
            <span className="sr-only"> ({t("required")})</span>
          </>
        }
        name="provider-mode"
        value={state.providerMode}
        options={[
          { value: "INTERNAL", label: t("internal") },
          { value: "EXTERNAL", label: t("external") },
        ]}
        onChange={(mode) => dispatch({ type: "setProviderMode", mode })}
      />

      {external ? (
        <div className="space-y-4">
          <Field label={t("supplier")} required error={message(errors.supplier)}>
            {(control) => (
              <Select
                name="providerId"
                value={state.providerId}
                onChange={(e) => dispatch({ type: "set", patch: { providerId: e.target.value } })}
                {...control}
              >
                <option value="">{t("chooseSupplier")}</option>
                {options.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {!state.providerId && !registering ? (
            options.user.admin ? (
              <Button variant="secondary" icon={<Plus />} onClick={() => setRegistering(true)}>
                {t("registerSupplier")}
              </Button>
            ) : (
              <p className="text-sm text-fg-secondary">
                {t("supplierMissingMember")}{" "}
                <Link
                  href="/records/organizations"
                  className="text-accent-text underline underline-offset-2"
                >
                  {t("browsePartners")}
                </Link>
              </p>
            )
          ) : null}

          {registering && options.user.admin ? (
            <SupplierRegistration
              onCancel={() => setRegistering(false)}
              onRegistered={(organization) => {
                onSupplierRegistered(organization);
                setRegistering(false);
              }}
            />
          ) : null}
        </div>
      ) : (
        <Field
          label={t("internalDescription")}
          hint={t("internalDescriptionHint")}
          error={message(errors.sourceDescription)}
        >
          {(control) => (
            <Textarea
              name="sourceDescription"
              rows={3}
              value={state.sourceDescription}
              maxLength={SOURCE_DESCRIPTION_MAX + 200}
              placeholder={t("internalDescriptionPlaceholder")}
              onChange={(e) =>
                dispatch({ type: "set", patch: { sourceDescription: e.target.value } })
              }
              {...control}
            />
          )}
        </Field>
      )}

      {hasUnits ? (
        <div className="space-y-4">
          <Field
            label={t("location")}
            required
            hint={t("locationHint")}
            error={message(errors.location)}
          >
            {(control) => (
              <Select
                name="locationId"
                value={state.locationId}
                onChange={(e) => dispatch({ type: "set", patch: { locationId: e.target.value } })}
                {...control}
              >
                <option value="">{t("chooseLocation")}</option>
                {options.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.capacity
                      ? t("locationWithCapacity", {
                          name: l.name,
                          occupancy: l.occupancy,
                          capacity: l.capacity,
                        })
                      : t("locationWithCount", { name: l.name, count: l.occupancy })}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {addingLocation && options.user.admin ? (
            <NewLocationForm
              onCancel={() => setAddingLocation(false)}
              onCreated={(created) => {
                onLocationAdded(created);
                setAddingLocation(false);
              }}
            />
          ) : options.user.admin ? (
            <Button variant="secondary" icon={<Plus />} onClick={() => setAddingLocation(true)}>
              {t("newLocation")}
            </Button>
          ) : (
            <p className="text-sm text-fg-secondary">{t("locationMissingMember")}</p>
          )}

          {capacity.status === "exceeded" ? (
            <Banner tone="warning" title={t("capacity.exceededTitle")}>
              {t("capacity.exceeded", {
                name: location?.name ?? "",
                planned: capacity.projected,
                capacity: capacity.capacity,
                occupancy: capacity.occupancy,
              })}
            </Banner>
          ) : capacity.status === "full" ? (
            <Banner tone="info">
              {t("capacity.full", { name: location?.name ?? "", capacity: capacity.capacity })}
            </Banner>
          ) : capacity.status === "within" ? (
            <p className="text-sm text-fg-secondary" aria-live="polite">
              {t("capacity.within", {
                name: location?.name ?? "",
                projected: capacity.projected,
                capacity: capacity.capacity,
                remaining: capacity.capacity - capacity.projected,
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <Banner tone="info">{t("noUnits")}</Banner>
      )}
    </div>
  );
}
