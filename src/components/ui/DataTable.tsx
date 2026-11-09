import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PAGE_SIZE } from "@/lib/list-params";
import { PagedItems, Pager, PagerControls } from "./Pager";
import { SortHeader } from "./SortHeader";
import type { SortOrder, SortState } from "./sort";
import { tdBase, thBase } from "./styles";

/*
 * Usage (server component, state in the URL):
 *   <DataTable
 *     caption="Units"
 *     columns={[
 *       { id: "code", header: "Code", sortKey: "code", rowHeader: true, cell: (u) => u.code },
 *       { id: "status", header: "Status", cell: (u) => <StatusBadge .../> },
 *     ]}
 *     rows={units}
 *     rowKey={(u) => u.id}
 *     sort={{ sort, order }}
 *     buildSortHref={(s, o) => `/inventory/units?sort=${s}&order=${o}`}
 *     empty={<EmptyState .../>}
 *   />
 *
 * Semantic <table>: required <caption>, <th scope="col">, aria-sort on the active column, optional
 * sticky header. It sits in a horizontally scrollable region (tabindex=0 and labelled, so keyboard
 * users can scroll it). Cells wrap, so longer French text never gets truncated. No "use client".
 *
 * More than one page of rows (10) is paged on the page itself, with Previous / Next and page numbers
 * under the table (`Pager`). Pass `clientPaging={false}` when the rows already arrive in pages from the
 * server and a link-based <Pagination> sits below, so a list is never paged twice. Printing shows
 * every row.
 *
 * Below the `md` breakpoint the table is swapped for a list of cards (one per row: the row header as
 * the title, then each column as a label and value) because seven columns do not fit a phone. The
 * table stays in the document for larger screens; the card list is `md:hidden`, the table `max-md:hidden`.
 */
export type Column<Row> = {
  id: string;
  /** Column title (text). */
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Makes the header a sort link; requires `sort` and `buildSortHref` on the table. */
  sortKey?: string;
  /** Render the cell as <th scope="row"> (the record's identifier). */
  rowHeader?: boolean;
  align?: "start" | "end";
  /** Hide the header text visually (e.g. a trailing actions column) but keep it for screen readers. */
  hideHeader?: boolean;
  className?: string;
};

export type DataTableProps<Row> = {
  /** Accessible title of the table. Always present in the DOM. */
  caption: string;
  /** Visually hide the caption (it still names the table). */
  captionHidden?: boolean;
  columns: Array<Column<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string | number;
  sort?: SortState;
  buildSortHref?: (sort: string, order: SortOrder) => string;
  stickyHeader?: boolean;
  density?: "comfortable" | "compact";
  /** Shown in place of the rows when there are none. Defaults to a plain "No results." */
  empty?: ReactNode;
  /** Page the rows on the page itself when there are more than `pageSize`. Defaults to true. */
  clientPaging?: boolean;
  /**
   * Starts each run of rows with the same key under a heading row. The rows must come sorted by
   * the group. Not combined with paging on the page itself, which would split the headings off.
   */
  groupBy?: { key: (row: Row) => string; label: (row: Row) => ReactNode };
  pageSize?: number;
  className?: string;
};

export function DataTable<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowKey,
  sort = {},
  buildSortHref,
  stickyHeader = false,
  density = "comfortable",
  empty,
  clientPaging = true,
  pageSize = PAGE_SIZE,
  groupBy,
  className,
}: DataTableProps<Row>) {
  const t = useTranslations("ui");
  const cellPadding = density === "compact" ? "py-2.5" : "py-4";
  const stickyHead = stickyHeader
    ? "sticky top-0 z-10 bg-surface shadow-[0_1px_0_var(--color-border-strong)]"
    : "";
  const hasRows = rows.length > 0;
  const emptyContent = empty ?? <span className="text-fg-secondary">{t("table.empty")}</span>;
  const titleColumn = columns.find((column) => column.rowHeader);
  const detailColumns = columns.filter((column) => column !== titleColumn && !column.hideHeader);
  const actionColumns = columns.filter((column) => column !== titleColumn && column.hideHeader);

  const paged = clientPaging && rows.length > pageSize;
  const grouping = paged ? undefined : groupBy;
  const groupStart = (index: number) =>
    grouping !== undefined &&
    (index === 0 || grouping.key(rows[index - 1]!) !== grouping.key(rows[index]!));

  const rowElements = rows.flatMap((row, index) => [
    ...(grouping && groupStart(index)
      ? [
          <tr key={`group-${index}`} className="bg-sunken">
            <th
              colSpan={columns.length}
              scope="colgroup"
              className={cn(tdBase, "py-2 text-start text-xs font-semibold text-fg-secondary")}
            >
              {grouping.label(row)}
            </th>
          </tr>,
        ]
      : []),
    <tr key={rowKey(row)}>
      {columns.map((column) => {
        const classes = cn(
          tdBase,
          cellPadding,
          "wrap-break-word",
          column.align === "end" && "text-right",
          column.className
        );
        return column.rowHeader ? (
          <th key={column.id} scope="row" className={cn(classes, "text-start font-medium")}>
            {column.cell(row)}
          </th>
        ) : (
          <td key={column.id} className={classes}>
            {column.cell(row)}
          </td>
        );
      })}
    </tr>,
  ]);

  const cardElements = rows.flatMap((row, index) => [
    ...(grouping && groupStart(index)
      ? [
          <li key={`group-${index}`} className="pt-5 pb-2 text-xs font-semibold text-fg-secondary">
            {grouping.label(row)}
          </li>,
        ]
      : []),
    <li
      key={rowKey(row)}
      style={{ "--i": Math.min(index % pageSize, 8) } as CSSProperties}
      className="rise border-b border-border py-4"
    >
      {titleColumn ? (
        <div className="text-base font-medium wrap-break-word">{titleColumn.cell(row)}</div>
      ) : null}
      <dl className={cn("divide-y divide-border text-sm", titleColumn && "mt-3")}>
        {detailColumns.map((column) => (
          <div key={column.id} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="shrink-0 text-fg-tertiary">{column.header}</dt>
            <dd className="min-w-0 text-end wrap-break-word text-fg">{column.cell(row)}</dd>
          </div>
        ))}
      </dl>
      {actionColumns.length > 0 ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {actionColumns.map((column) => (
            <div key={column.id}>{column.cell(row)}</div>
          ))}
        </div>
      ) : null}
    </li>,
  ]);

  const content = (
    <>
      <div
        role="region"
        tabIndex={0}
        aria-label={t("table.region", { caption })}
        className={cn(
          "overflow-x-auto border-b border-border",
          // With rows, a phone gets the card list below instead. With none, the one empty message is
          // shown here at every size, so it is never in the page twice.
          hasRows && "max-md:hidden",
          stickyHeader && "max-h-[70dvh] overflow-y-auto",
          className
        )}
      >
        <table
          className={cn(
            "w-full border-collapse text-sm",
            hasRows && "min-w-max",
            "[&_tbody_tr:last-child>*]:border-b-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-hover/60 motion-reduce:[&_tbody_tr]:transition-none"
          )}
        >
          <caption
            className={
              captionHidden ? "sr-only" : "px-4 py-3 text-left text-sm font-semibold text-fg"
            }
          >
            {caption}
          </caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const headerContent = column.hideHeader ? (
                  <span className="sr-only">{column.header}</span>
                ) : (
                  column.header
                );
                if (column.sortKey && buildSortHref) {
                  return (
                    <SortHeader
                      key={column.id}
                      sortKey={column.sortKey}
                      current={sort}
                      buildHref={buildSortHref}
                      align={column.align}
                      className={cn(stickyHead, column.className)}
                    >
                      {headerContent}
                    </SortHeader>
                  );
                }
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={cn(
                      thBase,
                      stickyHead,
                      column.align === "end" && "text-right",
                      column.className
                    )}
                  >
                    {headerContent}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={cn(tdBase, "py-8 text-center")}>
                  {emptyContent}
                </td>
              </tr>
            ) : paged ? (
              <PagedItems>{rowElements}</PagedItems>
            ) : (
              rowElements
            )}
          </tbody>
        </table>
      </div>

      {hasRows ? (
        <ul aria-label={caption} className={cn("md:hidden", className)}>
          {paged ? <PagedItems>{cardElements}</PagedItems> : cardElements}
        </ul>
      ) : null}
    </>
  );

  return paged ? (
    <Pager total={rows.length} pageSize={pageSize}>
      {content}
      <PagerControls />
    </Pager>
  ) : (
    content
  );
}
