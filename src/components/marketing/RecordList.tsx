import { getTranslations } from "next-intl/server";

const RECORDS = ["inventory", "destruction", "custody", "audit"] as const;

/** The four kinds of record the system keeps, as a ruled list. */
export async function RecordList() {
  const t = await getTranslations("marketing.compliance");

  return (
    <ul aria-label={t("ledgerLabel")} className="divide-y divide-border border-y border-border">
      {RECORDS.map((record) => (
        <li key={record} className="grid gap-x-6 gap-y-1 py-6 sm:grid-cols-[4rem_1fr]">
          <span className="font-mono text-xs font-semibold tracking-[0.16em] text-accent-text sm:pt-1.5">
            {t(`codes.${record}`)}
          </span>
          <div>
            <h3 className="text-lg font-semibold tracking-tight">{t(`lines.${record}.title`)}</h3>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-fg-secondary">
              {t(`lines.${record}.detail`)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
