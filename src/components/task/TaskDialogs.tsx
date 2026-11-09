"use client";

import {
  CalendarClock,
  Check,
  EllipsisVertical,
  Plus,
  RotateCcw,
  UserRound,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/DropdownMenu";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/FormControls";
import { IconButton } from "@/components/ui/IconButton";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { useRequestAction } from "../use-request-action";

export type TaskFormOptions = {
  experiments: ReadonlyArray<{ id: number; ecode: string; name: string }>;
  members: ReadonlyArray<{ id: number; name: string }>;
};

/** The "New task" button and its form. A fixed experiment or unit is planned on without asking. */
export function NewTaskButton({
  options,
  today,
  experiment,
  unit,
  assignee,
  label,
  variant = "primary",
}: {
  options: TaskFormOptions;
  /** Today in the laboratory's time zone, the default due day. */
  today: string;
  experiment?: { id: number; ecode: string };
  unit?: { id: number; name: string };
  /** The member the task is for, chosen already (a member's page). */
  assignee?: number;
  /** The button's text, when "New task" does not say it. */
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("tasks.form");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon={<Plus />} onClick={() => setOpen(true)}>
        {label ?? t("open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t("title")} description={t("description")}>
        <TaskForm
          options={options}
          today={today}
          experiment={experiment}
          unit={unit}
          assignee={assignee}
          onClose={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function TaskForm({
  options,
  today,
  experiment,
  unit,
  assignee,
  onClose,
}: {
  options: TaskFormOptions;
  today: string;
  experiment?: { id: number; ecode: string };
  unit?: { id: number; name: string };
  assignee?: number;
  onClose: () => void;
}) {
  const t = useTranslations("tasks.form");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(today);
  const [experimentId, setExperimentId] = useState(experiment ? String(experiment.id) : "");
  const [assigneeId, setAssigneeId] = useState(assignee ? String(assignee) : "");
  const [details, setDetails] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setTitleError(t("titleRequired"));
      return;
    }
    setTitleError(null);
    const result = await action.run(() =>
      sendJson("/api/tasks", {
        title: title.trim(),
        dueDate: due,
        experimentId: experimentId || undefined,
        unitId: unit?.id,
        assigneeId: assigneeId || undefined,
        details,
      })
    );
    if (!result.ok) return;
    toast({ tone: "success", title: t("created", { title: title.trim() }) });
    router.refresh();
    onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {action.error ? <Banner tone="danger">{action.error}</Banner> : null}
      <Field label={t("what")} error={titleError} required>
        {(control) => (
          <Input
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
            {...control}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("due")} required>
          {(control) => (
            <Input
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("assignee")}>
          {(control) => (
            <Select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              {...control}
            >
              <option value="">{t("nobody")}</option>
              {options.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {unit ? (
        <p className="text-sm text-fg-secondary">{t("onUnit", { name: unit.name })}</p>
      ) : experiment ? (
        <p className="text-sm text-fg-secondary">{t("onExperiment", { code: experiment.ecode })}</p>
      ) : (
        <Field label={t("experiment")}>
          {(control) => (
            <Select
              value={experimentId}
              onChange={(event) => setExperimentId(event.target.value)}
              {...control}
            >
              <option value="">{t("wholeLab")}</option>
              {options.experiments.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.ecode} · {option.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label={t("details")} hint={t("detailsHint")}>
        {(control) => (
          <Textarea
            value={details}
            rows={3}
            maxLength={2000}
            onChange={(event) => setDetails(event.target.value)}
            {...control}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={action.pending}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}

type TaskSummary = {
  id: number;
  title: string;
  due: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  assigneeId: number | null;
};

/** A task's controls: done at one click, and a menu to move, reassign, cancel or reopen it. */
export function TaskRowActions({
  task,
  members,
}: {
  task: TaskSummary;
  members: TaskFormOptions["members"];
}) {
  const t = useTranslations("tasks.actions");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const [dialog, setDialog] = useState<"move" | "assign" | "cancel" | null>(null);
  const [due, setDue] = useState(task.due);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ? String(task.assigneeId) : "");

  async function run(body: Record<string, unknown>, success: string) {
    const result = await action.run(() => sendJson(`/api/tasks/${task.id}`, body, "PATCH"));
    if (!result.ok) {
      if (dialog === null) toast({ tone: "danger", title: t("failed") });
      return;
    }
    toast({ tone: "success", title: success });
    setDialog(null);
    router.refresh();
  }

  const open = (kind: "move" | "assign" | "cancel") => {
    action.reset();
    setDialog(kind);
  };

  return (
    <div className="flex items-center justify-end gap-1">
      {task.status === "OPEN" ? (
        <Button
          size="sm"
          variant="secondary"
          icon={<Check />}
          loading={action.pending && dialog === null}
          onClick={() => void run({ action: "complete" }, t("doneToast", { title: task.title }))}
        >
          {t("done")}
        </Button>
      ) : null}
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={t("menu", { title: task.title })} size="sm">
            <EllipsisVertical />
          </IconButton>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>{task.title}</MenuLabel>
          {task.status === "OPEN" ? (
            <>
              <MenuItem icon={<CalendarClock />} onSelect={() => open("move")}>
                {t("move")}
              </MenuItem>
              <MenuItem icon={<UserRound />} onSelect={() => open("assign")}>
                {t("assign")}
              </MenuItem>
              <MenuItem icon={<X />} tone="danger" onSelect={() => open("cancel")}>
                {t("cancel")}
              </MenuItem>
            </>
          ) : (
            <MenuItem
              icon={<RotateCcw />}
              onSelect={() => void run({ action: "reopen" }, t("updated"))}
            >
              {t("reopen")}
            </MenuItem>
          )}
        </MenuContent>
      </Menu>

      <Dialog
        open={dialog === "move"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={t("moveTitle", { title: task.title })}
        size="sm"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run({ action: "reschedule", dueDate: due }, t("updated"));
          }}
        >
          {action.error ? <Banner tone="danger">{action.error}</Banner> : null}
          <Field label={t("moveDue")} required>
            {(control) => (
              <Input
                type="date"
                value={due}
                onChange={(event) => setDue(event.target.value)}
                {...control}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button type="submit" variant="primary" loading={action.pending}>
              {t("moveSubmit")}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === "assign"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={t("assignTitle", { title: task.title })}
        size="sm"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run({ action: "assign", assigneeId: assigneeId || null }, t("updated"));
          }}
        >
          {action.error ? <Banner tone="danger">{action.error}</Banner> : null}
          <Field label={t("assignee")}>
            {(control) => (
              <Select
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                {...control}
              >
                <option value="">{t("nobody")}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button type="submit" variant="primary" loading={action.pending}>
              {t("assignSubmit")}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={t("cancelTitle", { title: task.title })}
        description={t("cancelBody")}
        confirmLabel={t("cancelConfirm")}
        requireReason
        reasonMinLength={3}
        reasonHint={t("reasonHint")}
        pending={action.pending}
        error={action.error}
        onConfirm={({ reason }) => {
          void run({ action: "cancel", reason }, t("updated"));
        }}
      />
    </div>
  );
}
