"use client";

import { Bookmark, Columns3, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { Link, useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { HIDE_PARAM, toggleColumn, type ViewList } from "@/lib/table-view";
import { useRequestAction } from "./use-request-action";

/** The list's current query, without the page: what a column change or a saved view starts from. */
type ListState = { base: string; query: string };

function withParam(query: string, key: string, value: string | null) {
  const params = new URLSearchParams(query);
  params.delete("page");
  if (value) params.set(key, value);
  else params.delete(key);
  return params.toString();
}

/** Shows or hides a list's optional columns; the choice is kept in the URL. */
export function ColumnsMenu({
  state,
  columns,
  hidden,
}: {
  state: ListState;
  columns: ReadonlyArray<{ id: string; label: string }>;
  hidden: readonly string[];
}) {
  const t = useTranslations("ui.tableTools");
  const router = useRouter();

  function toggle(id: string) {
    const next = toggleColumn(hidden, id);
    const query = withParam(state.query, HIDE_PARAM, next.join(","));
    router.replace(query ? `${state.base}?${query}` : state.base, { scroll: false });
  }

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" size="sm" icon={<Columns3 />}>
          {hidden.length > 0 ? t("columnsHidden", { count: hidden.length }) : t("columns")}
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{t("columnsLabel")}</MenuLabel>
        {columns.map((column) => (
          <MenuCheckboxItem
            key={column.id}
            checked={!hidden.includes(column.id)}
            // Stay open, so several columns can be changed in a row.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => toggle(column.id)}
          >
            {column.label}
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/** The member's saved views of a list: open one, save the current one, delete it. */
export function SavedViewsMenu({
  list,
  state,
  views,
  current,
}: {
  list: ViewList;
  state: ListState;
  views: ReadonlyArray<{ id: number; name: string; query: string }>;
  /** The current query as a view saves it (normalized), to tell which saved view is open. */
  current: string;
}) {
  const t = useTranslations("ui.tableTools");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const active = views.find((view) => view.query === current);

  async function save(event: FormEvent) {
    event.preventDefault();
    const result = await action.run(() =>
      sendJson("/api/views", { list, name: name.trim(), query: state.query })
    );
    if (!result.ok) return;
    toast({ tone: "success", title: t("saved", { name: name.trim() }) });
    setSaving(false);
    router.refresh();
  }

  async function remove(view: { id: number; name: string }) {
    const result = await action.run(() => sendJson(`/api/views/${view.id}`, {}, "DELETE"));
    if (!result.ok) {
      toast({ tone: "danger", title: t("deleteFailed") });
      return;
    }
    toast({ tone: "success", title: t("deleted", { name: view.name }) });
    router.refresh();
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="sm" icon={<Bookmark />}>
            {active ? active.name : t("views")}
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>{t("viewsLabel")}</MenuLabel>
          {views.length === 0 ? (
            <p className="px-2.5 py-1.5 text-sm text-fg-secondary">{t("noViews")}</p>
          ) : (
            views.map((view) => (
              <MenuItem key={view.id} asChild>
                <Link
                  href={view.query ? `${state.base}?${view.query}` : state.base}
                  scroll={false}
                  aria-current={view.id === active?.id ? "true" : undefined}
                  className={view.id === active?.id ? "font-semibold" : undefined}
                >
                  {view.name}
                </Link>
              </MenuItem>
            ))
          )}
          <MenuSeparator />
          <MenuItem
            icon={<Bookmark />}
            onSelect={() => {
              action.reset();
              setName(active?.name ?? "");
              setSaving(true);
            }}
          >
            {t("save")}
          </MenuItem>
          {active ? (
            <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => void remove(active)}>
              {t("delete", { name: active.name })}
            </MenuItem>
          ) : null}
        </MenuContent>
      </Menu>
      <Dialog
        open={saving}
        onOpenChange={setSaving}
        title={t("saveTitle")}
        description={t("saveDescription")}
        dismissible={!action.pending}
      >
        <form onSubmit={save} className="space-y-4" noValidate>
          {action.error ? <Banner tone="danger">{action.error}</Banner> : null}
          <Field label={t("name")} hint={t("nameHint")} required>
            {(control) => (
              <Input
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                {...control}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setSaving(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={action.pending}
              disabled={!name.trim()}
            >
              {t("saveButton")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
