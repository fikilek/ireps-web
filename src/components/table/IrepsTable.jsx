/* eslint-disable no-unused-vars -- JSX tags are used by React. */
// The one iREPS table. Every table in iREPS is this component with different
// columns and rows: the same bands, headings, filters, pagination, colours and
// spacing, so a worker never has to learn a table twice (owner, 2026-09-23).
//
// A page gives it:
//   columns  [{ key, label, group?, filter, value(row), sortValue?, render?, align? }]
//   groups   [{ key, label }]  — the bands above the headings, optional
//   rows     the rows themselves
//   rowKey   how to identify a row
// It owns sorting and pagination. Filters can be controlled by a page so KPI
// cards and column filters share the same state. Downloads are standard.
import { useEffect, useMemo, useRef, useState } from "react";
import DownloadButtons from "../DownloadButtons";
import SalesRangeFilterModal from "../../pages/sales/components/SalesRangeFilterModal";
import { EMPTY_SALES_RANGE_FILTER, getSalesRangeFilterButtonLabel } from "../../pages/sales/salesUtils.js";
import {
  DatetimeFilterButton,
  DatetimeFilterModal,
  EMPTY_DATETIME_FILTER,
} from "../DatetimeFilter";
import { IREPS_TABLE_TOKENS as T } from "./irepsTableTokens.js";
import {
  IREPS_TABLE_DEFAULT_PAGE_SIZE,
  IREPS_TABLE_PAGE_SIZES,
  filterIrepsTableRows,
  irepsTableBands,
  irepsTableFilterActive,
  irepsTableSelectOptions,
  irepsTableDownloadColumns,
  paginateIrepsTableRows,
  sortIrepsTableRows,
} from "./irepsTableModel.js";

export default function IrepsTable({
  title = "Rows",
  columns = [],
  groups = [],
  rows = [],
  rowKey = (row, index) => row?.id ?? index,
  defaultSort = {},
  defaultPageSize = IREPS_TABLE_DEFAULT_PAGE_SIZE,
  emptyText = "No rows match the current filters.",
  loading = false,
  loadingText = "Loading…",
  toolbar = null,
  onRowsShown = null,
  filters: controlledFilters,
  onFiltersChange,
  searchValue = null,
  searchLabel = "Search all row fields",
  searchPlaceholder = "IDs, meters, addresses, reasons, references…",
  downloads = {},
  filterRows = null,
  // Pages with KPIs can reuse the same domain-filtered rows here, avoiding a
  // second pass. filterRows remains the domain matching contract.
  filteredRows: providedFilteredRows = null,
  stickyHeader = false,
  // Owner, 10 October 2026, on the Meter Registry. Off by default: IrepsTable
  // is shared by every registry, so these are switched on one table at a time
  // rather than changing eight at once.
  stickyFirstColumn = false,
  topScrollbar = false,
  maxHeight,
  rowStyle,
  onRowClick,
}) {
  const topScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const tableRef = useRef(null);
  const syncingRef = useRef(false);
  const [tableWidth, setTableWidth] = useState(0);

  // The strip above the table scrolls nothing of its own: it holds a spacer as
  // wide as the table, and the two keep each other in step. The guard stops
  // the pair bouncing a scroll back and forth between them.
  function syncScroll(from, to) {
    if (syncingRef.current || !from.current || !to.current) return;

    syncingRef.current = true;
    to.current.scrollLeft = from.current.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }

  useEffect(() => {
    if (!topScrollbar) return undefined;

    const table = tableRef.current;

    if (!table || typeof ResizeObserver === "undefined") return undefined;

    const measure = () => setTableWidth(table.scrollWidth);

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(table);

    return () => observer.disconnect();
  }, [topScrollbar, columns.length]);

  const [internalFilters, setInternalFilters] = useState({});
  const filters = controlledFilters ?? internalFilters;
  const setFilters = onFiltersChange ?? setInternalFilters;
  const [sort, setSort] = useState(defaultSort);
  const [pageState, setPageState] = useState({ page: 1, filters });
  const page = pageState.filters === filters ? pageState.page : 1;
  const setPage = (nextPage) => setPageState({ page: nextPage, filters });
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [dateFilterFor, setDateFilterFor] = useState("");
  const [rangeFilterFor, setRangeFilterFor] = useState("");

  const filtered = useMemo(
    () => providedFilteredRows ?? (filterRows ? filterRows(rows, filters) : filterIrepsTableRows(rows, columns, { filters, searchValue })),
    [rows, columns, filters, searchValue, filterRows, providedFilteredRows],
  );

  const sorted = useMemo(
    () => sortIrepsTableRows(filtered, columns, sort),
    [filtered, columns, sort],
  );

  const current = paginateIrepsTableRows(sorted, page, pageSize);
  const bands = irepsTableBands(columns, groups);
  const filtersOn = Boolean(String(filters.$search || "").trim()) || columns.some(
    column => column.isFilterActive
      ? column.isFilterActive(filters)
      : irepsTableFilterActive(column, filters[column.key]),
  ) || Boolean(filterRows && Object.values(filters).some(
    value => value && (typeof value === "object" ? value.mode && value.mode !== "ALL" : value !== "ALL"),
  ));

  useEffect(() => {
    onRowsShown?.(sorted);
  }, [sorted, onRowsShown]);

  function setFilter(key, value) {
    setFilters((currentFilters) => ({ ...currentFilters, [key]: value }));
    setPage(1);
  }

  function onSort(key) {
    setPage(1);
    setSort((currentSort) =>
      currentSort.key !== key
        ? { key, direction: "asc" }
        : currentSort.direction === "asc"
          ? { key, direction: "desc" }
          : defaultSort,
    );
  }

  const pagination = (
    <Pagination
      filtersOn={filtersOn}
      onClear={() => setFilters({})}
      page={current.page}
      pageSize={pageSize}
      totalPages={current.totalPages}
      totalRows={sorted.length}
      onPage={setPage}
      onPageSize={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );

  return (
    <section style={stickyHeader ? styles.frameSticky : styles.frame} aria-label={title}>
      <div style={stickyHeader ? styles.stickyTop : undefined}>
      <div style={styles.toolbar}>
        <strong>{title}</strong>
        <span style={{ ...styles.muted, marginLeft: "auto" }} aria-live="polite">
          {sorted.length} of {rows.length} rows
        </span>
        {toolbar}
        <DownloadButtons
          registryName={title}
          fileBaseName="table_rows"
          columns={irepsTableDownloadColumns(columns)}
          {...downloads}
          visibleRows={sorted}
          onFullDownload={downloads.onFullDownload ? () => downloads.onFullDownload(sorted) : null}
        />
      </div>

      {searchValue ? <div style={styles.searchBar}>
        <label style={styles.muted}>
          {searchLabel}
          <input type="search" style={{ ...styles.filter, marginTop: 4 }} value={filters.$search || ""}
            placeholder={searchPlaceholder}
            onChange={event => setFilter("$search", event.target.value)} />
        </label>
      </div> : null}

      {pagination}

      {topScrollbar ? (
        <div
          ref={topScrollRef}
          style={styles.topScroll}
          onScroll={() => syncScroll(topScrollRef, bodyScrollRef)}
          aria-hidden="true"
        >
          <div style={{ width: tableWidth, height: 1 }} />
        </div>
      ) : null}

      </div>

      <div
        ref={bodyScrollRef}
        style={{ ...styles.scroll, maxHeight }}
        onScroll={topScrollbar ? () => syncScroll(bodyScrollRef, topScrollRef) : undefined}
      >
        <table ref={tableRef} style={styles.table}>
          <thead style={stickyHeader ? { position: "sticky", top: 0, zIndex: 2, background: T.headBackground } : undefined}>
            {bands.length ? (
              <tr>
                {bands.map((band) => (
                  <th key={band.key} colSpan={band.span} style={styles.band}>
                    {band.label}
                  </th>
                ))}
              </tr>
            ) : null}

            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : undefined} style={{ ...styles.head, minWidth: column.minWidth, ...(stickyFirstColumn && column === columns[0] ? styles.pinnedHead : null) }}>
                  {(column.sortable ?? Boolean(column.filter)) ? (
                    <button
                      type="button"
                      style={styles.sortButton}
                      onClick={() => onSort(column.key)}
                      title={`Sort by ${column.label}`}
                    >
                      <span>{column.label}</span>
                      <span aria-hidden="true">
                        {sort.key === column.key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>

            <tr>
              {columns.map((column) => (
                <th key={column.key} style={{ ...styles.filterCell, ...(stickyFirstColumn && column === columns[0] ? styles.pinnedFilter : null) }}>
                  {column.renderFilter ? column.renderFilter({ filters, setFilter }) : !column.filter ? null : column.filter === "select" ? (
                    <select
                      aria-label={`Filter ${column.label}`}
                      style={styles.filter}
                      value={filters[column.key] === column.filterAllValue ? "" : filters[column.key] || ""}
                      disabled={column.filterDisabled}
                      onChange={(event) => setFilter(column.key, event.target.value)}
                    >
                      <option value="">All</option>
                      {irepsTableSelectOptions(rows, column).map((option) => (
                        <option key={typeof option === "object" ? option.value : option} value={typeof option === "object" ? option.value : option}>
                          {typeof option === "object" ? option.label : option}
                        </option>
                      ))}
                    </select>
                  ) : column.filter === "salesRange" ? (
                    <button type="button" style={styles.filter} onClick={() => setRangeFilterFor(column.key)} aria-label={`Filter ${column.label}`}>
                      {getSalesRangeFilterButtonLabel(filters[column.key] || EMPTY_SALES_RANGE_FILTER)}
                    </button>
                  ) : column.filter === "date" ? (
                    <DatetimeFilterButton
                      filter={filters[column.key] || EMPTY_DATETIME_FILTER}
                      fieldLabel={column.label}
                      onClick={() => setDateFilterFor(column.key)}
                    />
                  ) : (
                    <input
                      aria-label={`Filter ${column.label}`}
                      style={styles.filter}
                      value={filters[column.key] || ""}
                      disabled={column.filterDisabled}
                      onChange={(event) => setFilter(column.key, event.target.value)}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {current.rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                style={{ ...(index % 2 ? styles.stripeRow : styles.row), ...rowStyle?.(row) }}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    style={{ ...styles.cell, minWidth: column.minWidth, textAlign: column.align || "left", ...column.cellStyle, ...(stickyFirstColumn && column === columns[0] ? styles.pinnedCell : null) }}
                  >
                    {column.render ? column.render(row, index) : column.value?.(row)}
                  </td>
                ))}
              </tr>
            ))}

            {!sorted.length ? (
              <tr>
                <td style={styles.cell} colSpan={columns.length}>
                  {loading ? loadingText : emptyText}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pagination}

      {rangeFilterFor ? <SalesRangeFilterModal
        columnLabel={columns.find(column => column.key === rangeFilterFor)?.label || ""}
        filter={filters[rangeFilterFor] || EMPTY_SALES_RANGE_FILTER}
        onApply={filter => { setFilter(rangeFilterFor, filter); setRangeFilterFor(""); }}
        onClear={() => { setFilter(rangeFilterFor, EMPTY_SALES_RANGE_FILTER); setRangeFilterFor(""); }}
        onClose={() => setRangeFilterFor("")}
      /> : null}

      {dateFilterFor ? (
        <DatetimeFilterModal
          filter={filters[dateFilterFor] || EMPTY_DATETIME_FILTER}
          fieldLabel={columns.find((column) => column.key === dateFilterFor)?.label || ""}
          onApply={(filter) => {
            setFilter(dateFilterFor, filter);
            setDateFilterFor("");
          }}
          onClear={() => {
            setFilter(dateFilterFor, EMPTY_DATETIME_FILTER);
            setDateFilterFor("");
          }}
          onClose={() => setDateFilterFor("")}
        />
      ) : null}
    </section>
  );
}

// Compound domain filters use the same inputs and spacing as ordinary columns.
export function IrepsTableFilterInput({ value, onChange, placeholder, style, ...props }) {
  return <input {...props} aria-label={props["aria-label"] || placeholder} value={value || ""} onChange={event => onChange(event.target.value)} placeholder={placeholder} style={{ ...styles.filter, ...style }} />;
}

export function IrepsTableFilterSelect({ value, onChange, children, style, ...props }) {
  return <select {...props} value={value ?? "ALL"} onChange={event => onChange(event.target.value)} style={{ ...styles.filter, ...style }}>{children}</select>;
}

function Pagination({ page, pageSize, totalPages, totalRows, onPage, onPageSize, filtersOn, onClear }) {
  const first = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalRows);

  return (
    <div style={styles.pagination}>
      <span style={styles.muted}>
        Showing {first}-{last} of {totalRows} rows
      </span>

      <div style={styles.filterAndSize}>
        <button type="button" style={styles.clearButton} disabled={!filtersOn} onClick={onClear}>Clear Filters</button>
        <label style={styles.pageSize}>
        Rows per page
        <select
          style={{ ...styles.filter, width: "auto", minWidth: 55 }}
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
        >
          {IREPS_TABLE_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      </div>

      <div style={styles.pageButtons}>
        <button type="button" style={styles.pageButton} disabled={page <= 1} onClick={() => onPage(1)}>
          First
        </button>
        <button
          type="button"
          style={styles.pageButton}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span style={styles.muted}>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          style={styles.pageButton}
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
        <button
          type="button"
          style={styles.pageButton}
          disabled={page >= totalPages}
          onClick={() => onPage(totalPages)}
        >
          Last
        </button>
      </div>
    </div>
  );
}

const styles = {
  frame: {
    border: `1px solid ${T.border}`,
    borderRadius: T.radius,
    background: T.rowBackground,
    overflow: "hidden",
  },

  // Same card, but clipped rather than hidden. `overflow: hidden` makes an
  // element a scroll container, and a scroll container stops everything inside
  // it sticking to the page - which is why the top block could not stay
  // visible. `clip` cuts the corners the same way and is not a scroll
  // container, so sticky survives it.
  frameSticky: {
    border: `1px solid ${T.border}`,
    borderRadius: T.radius,
    background: T.rowBackground,
    overflow: "clip",
  },

  // Everything above the rows, held against the top of the screen: the title
  // and its downloads, the pagination, and the scrollbar. Opaque, or the rows
  // show through it as they pass underneath.
  stickyTop: {
    position: "sticky",
    top: 0,
    zIndex: 4,
    background: T.rowBackground,
  },

  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    background: T.toolbarBackground,
    borderBottom: `1px solid ${T.border}`,
  },

  pagination: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    background: T.toolbarBackground,
    borderBottom: `1px solid ${T.border}`,
    borderTop: `1px solid ${T.border}`,
  },

  pageSize: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: T.mutedText,
    fontSize: T.fontSize,
  },

  pageButtons: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },

  filterAndSize: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginLeft: "auto" },
  searchBar: { padding: "10px 14px", maxWidth: 450 },

  pageButton: {
    border: `1px solid ${T.filterBorder}`,
    background: T.rowBackground,
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: T.fontSize,
    fontWeight: 700,
    color: T.accent,
    cursor: "pointer",
  },

  clearButton: {
    border: `1px solid ${T.filterBorder}`,
    background: T.rowBackground,
    color: T.accent,
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: T.fontSize,
    fontWeight: 700,
    cursor: "pointer",
  },

  scroll: { overflowX: "auto" },

  // A second scrollbar, above the table. On a long table the only scrollbar is
  // at the foot of it, so reaching the right-hand columns means scrolling down
  // first. Paired with a sticky header this one stays within reach.
  topScroll: {
    overflowX: "auto",
    overflowY: "hidden",
    // Tall enough to grab in every browser; it carries nothing else.
    height: 14,
    borderBottom: `1px solid ${T.border}`,
  },

  // The pinned first column. It must be OPAQUE or the columns sliding under it
  // show through, and it must take the row's own background - stripe, hover or
  // whatever a page sets through rowStyle - or it detaches and reads as a
  // separate little table. `inherit` does both: the row already carries an
  // explicit background.
  pinnedCell: {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: "inherit",
    borderRight: `1px solid ${T.border}`,
    boxShadow: "2px 0 4px -2px rgba(15,23,42,0.18)",
  },
  pinnedHead: {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: T.headBackground,
    borderRight: `1px solid ${T.border}`,
    boxShadow: "2px 0 4px -2px rgba(15,23,42,0.18)",
  },
  pinnedFilter: {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: T.filterRowBackground,
    borderRight: `1px solid ${T.border}`,
    boxShadow: "2px 0 4px -2px rgba(15,23,42,0.18)",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: T.fontSize,
    color: T.text,
  },

  band: {
    background: T.bandBackground,
    color: T.text,
    fontSize: T.headingFontSize,
    fontWeight: 800,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    padding: "8px 12px",
    borderBottom: `1px solid ${T.border}`,
    textAlign: "center",
  },

  head: {
    background: T.headBackground,
    color: T.text,
    fontSize: T.headingFontSize,
    fontWeight: 800,
    padding: T.cellPadding,
    borderBottom: `1px solid ${T.border}`,
    textAlign: "left",
    whiteSpace: "nowrap",
  },

  filterCell: {
    background: T.filterRowBackground,
    padding: "6px 10px",
    borderBottom: `1px solid ${T.border}`,
  },

  sortButton: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    background: "none",
    padding: 0,
    color: "inherit",
    font: "inherit",
    fontWeight: 800,
    cursor: "pointer",
  },

  filter: {
    width: "100%",
    minWidth: 90,
    border: `1px solid ${T.filterBorder}`,
    borderRadius: 6,
    padding: "4px 6px",
    fontSize: T.fontSize,
    background: T.rowBackground,
  },

  row: { background: T.rowBackground },
  stripeRow: { background: T.stripeBackground },

  cell: {
    padding: T.cellPadding,
    borderBottom: `1px solid ${T.border}`,
    verticalAlign: "top",
  },

  muted: { color: T.mutedText, fontSize: T.fontSize },
};
