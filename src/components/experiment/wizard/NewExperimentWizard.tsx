"use client";

import { ArrowLeft, ArrowRight, FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Panel, PanelBody } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { WizardOptions } from "@/features/experiment/queries";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { storageKey } from "@/lib/brand";
import { sendForm } from "@/components/actions/use-action-submit";
import { sendJson } from "@/lib/client-api";
import { IdentityStep } from "./IdentityStep";
import { ReviewStep } from "./ReviewStep";
import { SourceStep } from "./SourceStep";
import { UnitsStep } from "./UnitsStep";
import { WizardStepList } from "./WizardStepList";
import {
  buildPayload,
  initialState,
  parseDraft,
  serializeDraft,
  WIZARD_STEPS,
  wizardReducer,
  type WizardStep,
} from "./wizard-state";
import {
  hasErrors,
  validateAll,
  validateStep,
  type StepErrors,
  type ValidationContext,
} from "./wizard-validation";

const subscribeNothing = () => () => {};

/**
 * The wizard reads the browser's session storage (a draft), so it is built on the client only. Until then the page shows a placeholder of the same height.
 */
export function NewExperimentWizard({ options }: { options: WizardOptions }) {
  const ready = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  );
  return ready ? <Wizard options={options} /> : <WizardPlaceholder />;
}

function WizardPlaceholder() {
  const t = useTranslations("experiments.wizard");
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

type Created = {
  id: number;
  ecode: string;
  units?: unknown[];
  receipt?: { reference: string } | null;
};

function Wizard({ options }: { options: WizardOptions }) {
  const t = useTranslations("experiments.wizard");
  const router = useRouter();
  const apiError = useApiError();
  const networkError = useNetworkError();
  const { toast } = useToast();

  const draftKey = `${storageKey("experiment-wizard-draft")}.${options.user.id}`;
  const hasContext = Boolean(options.parent || options.sourceUnit);
  const seed = () =>
    initialState({
      // The laboratory's calendar day, not the browser's: a start date is a day at the lab.
      today: options.today,
      parentExperimentId: options.parent?.id,
      sourceUnit: options.sourceUnit
        ? {
            kind: options.sourceUnit.suggestedKind,
            cultivarId: options.sourceUnit.cultivarId,
            growthStage: options.sourceUnit.growthStage,
            locationId: options.sourceUnit.locationId,
            providerMode: options.sourceUnit.providerMode === "EXTERNAL" ? "EXTERNAL" : "INTERNAL",
            providerOrganizationId: options.sourceUnit.providerOrganizationId,
            sourceDescription: options.sourceUnit.sourceDescription,
          }
        : null,
    });

  const [restored] = useState(() => {
    if (hasContext) return null;
    try {
      return parseDraft(sessionStorage.getItem(draftKey));
    } catch {
      return null;
    }
  });
  const [state, dispatch] = useReducer(wizardReducer, restored, (draft) =>
    draft ? { ...seed(), ...draft.state, capacityOverride: false } : seed()
  );
  const [step, setStep] = useState<WizardStep>(restored?.step ?? "identity");
  const [reached, setReached] = useState(restored ? WIZARD_STEPS.indexOf(restored.step) : 0);
  const [shown, setShown] = useState<Record<WizardStep, boolean>>({
    identity: false,
    units: false,
    source: false,
    review: false,
  });
  const [draftNotice, setDraftNotice] = useState(restored !== null);
  const [organizations, setOrganizations] = useState(options.organizations);
  const [cultivars, setCultivars] = useState(options.cultivars);
  const [locations, setLocations] = useState(options.locations);
  // Chosen on the review step and uploaded once the experiment exists; never kept in the draft.
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [capacityConflict, setCapacityConflict] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const submitted = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const stepOptions: WizardOptions = { ...options, organizations, cultivars, locations };
  const context: ValidationContext = { locations, capacityConflict };
  const allErrors = validateAll(state, context);
  const errorsFor = (target: WizardStep): StepErrors => (shown[target] ? allErrors[target] : {});

  // Keep the draft for this browser session (never sent anywhere), until the experiment is created.
  useEffect(() => {
    if (submitted.current) return;
    try {
      sessionStorage.setItem(draftKey, serializeDraft(step, state));
    } catch {
      // Storage may be unavailable (private windows); the form still works.
    }
  }, [draftKey, step, state]);

  // After a step change, or a failed attempt to leave one, move focus where the person must look.
  const focusTarget = useRef<"heading" | "invalid">("heading");
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (focusTarget.current === "invalid") {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [step, attempt]);

  function goTo(target: WizardStep) {
    focusTarget.current = "heading";
    setStep(target);
    setReached((r) => Math.max(r, WIZARD_STEPS.indexOf(target)));
    setAttempt((a) => a + 1);
  }

  function next() {
    if (hasErrors(validateStep(step, state, context))) {
      focusTarget.current = "invalid";
      setShown((s) => ({ ...s, [step]: true }));
      setAttempt((a) => a + 1);
      return;
    }
    goTo(WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1] ?? "review");
  }

  async function submit() {
    const invalid = WIZARD_STEPS.find((s) => hasErrors(allErrors[s]));
    if (invalid) {
      setShown((s) => ({ ...s, [invalid]: true }));
      if (invalid !== step) goTo(invalid);
      focusTarget.current = "invalid";
      setAttempt((a) => a + 1);
      return;
    }
    setSubmitting(true);
    setFailure(null);
    const result = await sendJson<Created>(
      "/api/experiments",
      buildPayload(state, { sourceUnitId: options.sourceUnit?.id, admin: options.user.admin })
    );
    if (!result.ok) {
      setSubmitting(false);
      if ((result.error as { capacityExceeded?: boolean } | null)?.capacityExceeded) {
        setCapacityConflict(true);
        setFailure(t("capacityRefused"));
        return;
      }
      setFailure(result.network ? networkError : apiError(result.error));
      return;
    }
    submitted.current = true;
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    const created = result.data;
    const unitCount = created.units?.length ?? 0;
    let uploaded = 0;
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const sent = await sendForm(`/api/experiments/${created.id}/documents`, form);
      if (sent.ok) uploaded += 1;
    }
    const failedFiles = files.length - uploaded;
    toast({
      tone: failedFiles > 0 ? "warning" : "success",
      title: t("created", { code: created.ecode }),
      description:
        (unitCount > 0 ? t("createdUnits", { count: unitCount }) : t("createdNoUnits")) +
        (created.receipt
          ? ` ${t("createdReceipt", { reference: created.receipt.reference })}`
          : "") +
        (uploaded > 0 ? ` ${t("createdFiles", { count: uploaded })}` : "") +
        (failedFiles > 0 ? ` ${t("filesFailed", { count: failedFiles })}` : ""),
    });
    router.push(`/inventory/experiments/${created.id}?created=1`);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (step === "review") void submit();
    else next();
  }

  function startOver() {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Ignore.
    }
    dispatch({ type: "replace", state: seed() });
    setFiles([]);
    setShown({ identity: false, units: false, source: false, review: false });
    setReached(0);
    setDraftNotice(false);
    goTo("identity");
  }

  const index = WIZARD_STEPS.indexOf(step);
  const stepProps = {
    state,
    dispatch,
    errors: errorsFor(step),
    options: stepOptions,
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6">
      {options.parent ? (
        <Banner tone="info" title={t("subExperimentTitle")}>
          {t("subExperimentBody", { code: options.parent.ecode, name: options.parent.name })}
        </Banner>
      ) : null}

      {draftNotice ? (
        <Banner tone="info" title={t("draftTitle")}>
          <p>{t("draftBody")}</p>
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={startOver}>
              {t("draftDiscard")}
            </Button>
          </div>
        </Banner>
      ) : null}

      <WizardStepList current={step} reached={reached} onSelect={goTo} />

      <Panel>
        <PanelBody className="space-y-6">
          <div>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="flex items-center gap-2 text-lg font-semibold text-fg outline-none"
            >
              <FlaskConical aria-hidden="true" className="size-5 text-fg-tertiary" />
              {t("stepOf", { current: index + 1, total: WIZARD_STEPS.length })}
              {": "}
              {t(`steps.${step}`)}
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">{t(`stepHints.${step}`)}</p>
          </div>

          {failure ? <Banner tone="danger">{failure}</Banner> : null}

          {step === "identity" ? <IdentityStep {...stepProps} /> : null}
          {step === "units" ? (
            <UnitsStep
              {...stepProps}
              onCultivarAdded={(cultivar) =>
                setCultivars((list) =>
                  [...list.filter((c) => c.id !== cultivar.id), cultivar].sort((a, b) =>
                    a.name.localeCompare(b.name)
                  )
                )
              }
            />
          ) : null}
          {step === "source" ? (
            <SourceStep
              {...stepProps}
              onSupplierRegistered={(organization) => {
                setOrganizations((list) =>
                  [...list.filter((o) => o.id !== organization.id), organization].sort((a, b) =>
                    a.name.localeCompare(b.name)
                  )
                );
                dispatch({
                  type: "set",
                  patch: { providerMode: "EXTERNAL", providerId: String(organization.id) },
                });
              }}
              onLocationAdded={(location) => {
                setLocations((list) =>
                  [...list.filter((l) => l.id !== location.id), { ...location, occupancy: 0 }].sort(
                    (a, b) => a.name.localeCompare(b.name)
                  )
                );
                dispatch({ type: "set", patch: { locationId: String(location.id) } });
              }}
            />
          ) : null}
          {step === "review" ? (
            <ReviewStep
              {...stepProps}
              capacityConflict={capacityConflict}
              files={files}
              onFilesChange={setFiles}
              onEdit={goTo}
            />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              variant="secondary"
              icon={<ArrowLeft />}
              disabled={index === 0 || submitting}
              onClick={() => goTo(WIZARD_STEPS[index - 1] ?? "identity")}
            >
              {t("back")}
            </Button>
            {step === "review" ? (
              <Button type="submit" variant="primary" loading={submitting}>
                {t("create")}
              </Button>
            ) : (
              <Button type="submit" variant="primary" iconAfter={<ArrowRight />}>
                {t("next")}
              </Button>
            )}
          </div>
        </PanelBody>
      </Panel>
    </form>
  );
}
