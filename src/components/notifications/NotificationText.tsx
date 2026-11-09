import { useTranslations } from "next-intl";
import { isKnownAction, isKnownEntityType } from "@/features/audit/links";
import type { NotificationRow } from "@/features/notification/queries";

/*
 * Usage: <NotificationText notification={row} />
 * One notice in the reader's language: "Lina gave you a task: T-0012 Water the mothers", or
 * "Lina · Stage changed · Unit CD-ROOTED-G-1" with the recorded summary underneath.
 */
export function NotificationText({ notification: n }: { notification: NotificationRow }) {
  const t = useTranslations("notifications.item");
  const actions = useTranslations("activity.actions");
  const types = useTranslations("activity.entityTypes");
  const actor = n.actorName ?? t("someone");

  if (n.kind === "task_assigned") {
    return (
      <span className="block text-fg">
        {t("taskAssigned", {
          actor,
          code: n.task?.code ?? "",
          title: n.task?.title ?? "",
        })}
      </span>
    );
  }
  const action = n.action ?? "";
  const type = n.entityType ?? "";
  return (
    <>
      <span className="block text-fg">
        {t("activity", {
          actor,
          action: isKnownAction(action) ? actions(action) : action,
          type: isKnownEntityType(type) ? types(type) : type,
          label: n.entityLabel ?? "",
        })}
      </span>
      {n.summary ? (
        <span className="mt-0.5 line-clamp-2 block text-fg-secondary">{n.summary}</span>
      ) : null}
    </>
  );
}
