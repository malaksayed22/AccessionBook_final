import { useFormatter, useTranslations } from "next-intl";
import { Banner } from "@/components/ui/Banner";
import type { ChainStatus } from "@/features/audit/queries";

/*
 * Usage: <AuditChainResult status={chain} />   (status null = not verified in this view)
 * The outcome of audit_verify_chain(), stated plainly: intact, or broken with the first broken
 * entry and what it means. A broken chain is announced assertively (role="alert" via the banner).
 */
export function AuditChainResult({ status }: { status: ChainStatus | null }) {
  const t = useTranslations("activity.chain");
  const format = useFormatter();

  if (!status) {
    return (
      <Banner tone="info" title={t("notRunTitle")}>
        {t("notRunBody")}
      </Banner>
    );
  }

  const when = format.dateTime(status.verifiedAt, "dateTime");

  if (status.firstBroken) {
    return (
      <Banner tone="danger" title={t("brokenTitle", { seq: status.firstBroken.seq })}>
        <p>{t("brokenBody", { seq: status.firstBroken.seq, entries: status.entries, when })}</p>
        <p className="mt-1">{t(`kinds.${status.firstBroken.kind}`)}</p>
        <p className="mt-1 font-medium">{t("brokenAction")}</p>
      </Banner>
    );
  }

  return status.entries === 0 ? (
    <Banner tone="success" title={t("emptyTitle")}>
      {t("emptyBody", { when })}
    </Banner>
  ) : (
    <Banner tone="success" title={t("intactTitle")}>
      {t("intactBody", { entries: status.entries, when })}
    </Banner>
  );
}
