/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useState } from "react";

import MeterLocationModal from "./MeterLocationModal";
import SalesRangeFilterModal from "./SalesRangeFilterModal";
import {
  TARGET_FILTERS,
  compareNatural,
  EMPTY_SALES_RANGE_FILTER,
  formatCurrencyFromCents,
  formatNumber,
  getMonthLabel,
  getSalesRangeFilterButtonLabel,
  getTargetFilterLabel,
  includesText,
  isSalesRangeFilterActive,
  matchesSalesRangeFilter,
  matchesTargetFilter,
} from "../salesUtils";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;
const DEFAULT_SORT = { key: "meterNo", direction: "asc" };

const DEFAULT_COLUMN_VISIBILITY = {
  wardNo: true,
  addressLine1: true,
  town: true,
  standNumber: false,
  totalSalesC: false,
  latest12MonthsSalesC: true,
  sales2024C: false,
  sales2025C: false,
  sales2026C: false,
};

const COLUMN_OPTIONS = [
  { key: "wardNo", label: "Ward No" },
  { key: "addressLine1", label: "Address" },
  { key: "town", label: "Town" },
  { key: "standNumber", label: "SG Code" },
  { key: "totalSalesC", label: "Total Sales" },
  { key: "latest12MonthsSalesC", label: "Latest 12 Months" },
  { key: "sales2024C", label: "Total Sales 2024" },
  { key: "sales2025C", label: "Total Sales 2025" },
  { key: "sales2026C", label: "Total Sales 2026" },
];

const STICKY_COLUMN_WIDTHS = {
  select: 54,
  meterNo: 155,
  wardNo: 105,
  addressLine1: 260,
  town: 135,
  standNumber: 230,
  totalSalesC: 145,
  latest12MonthsSalesC: 165,
  sales2024C: 150,
  sales2025C: 150,
  sales2026C: 150,
};

const EMPTY_FILTERS = {
  meterNo: "",
  wardNo: "ALL",
  addressLine1: "",
  town: "ALL",
  standNumber: "",
  salesRanges: {},
};

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;
  const directionLabel = isActive
    ? sortConfig.direction === "asc"
      ? "↑"
      : "↓"
    : "↕";

  return (
    <button
      type="button"
      style={styles.sortButton}
      onClick={() => onSort(sortKey)}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span>{directionLabel}</span>
    </button>
  );
}

function FilterInput({ value, onChange, placeholder, type = "text", min, step }) {
  return (
    <input
      type={type}
      min={min}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={styles.headerInput}
    />
  );
}

function SalesRangeFilterButton({ filter, onClick }) {
  const active = isSalesRangeFilterActive(filter);

  return (
    <button
      type="button"
      style={{
        ...styles.rangeFilterButton,
        ...(active ? styles.rangeFilterButtonActive : null),
      }}
      onClick={onClick}
      title={active ? "Edit active sales range filter" : "Open sales range filter"}
    >
      <span style={styles.rangeFilterCheckbox} aria-hidden="true">
        {active ? "☑" : "☐"}
      </span>
      <span style={styles.rangeFilterLabel}>
        {getSalesRangeFilterButtonLabel(filter)}
      </span>
    </button>
  );
}

function PaginationControls({
  currentPage,
  pageSize,
  totalPages,
  totalRows,
  onPageChange,
  onPageSizeChange,
}) {
  if (totalRows === 0) return null;

  const startRow = (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(currentPage * pageSize, totalRows);

  return (
    <div style={styles.paginationBar}>
      <div style={styles.paginationSummary}>
        Showing {formatNumber(startRow)}-{formatNumber(endRow)} of{" "}
        {formatNumber(totalRows)} rows
      </div>

      <div style={styles.paginationControls}>
        <label style={styles.pageSizeLabel}>
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            style={styles.pageSizeSelect}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
        >
          First
        </button>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <span style={styles.pageCountLabel}>
          Page {formatNumber(currentPage)} of {formatNumber(totalPages)}
        </span>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
        >
          Last
        </button>
      </div>
    </div>
  );
}

function getVisibleConfigurableKeys(columnVisibility) {
  return COLUMN_OPTIONS.map((option) => option.key).filter(
    (key) => columnVisibility[key],
  );
}

function buildStickyLayout(columnVisibility) {
  const orderedKeys = [
    "select",
    "meterNo",
    ...getVisibleConfigurableKeys(columnVisibility),
  ];

  let left = 0;

  return orderedKeys.reduce((layout, key) => {
    const width = STICKY_COLUMN_WIDTHS[key];
    layout[key] = { left, width };
    left += width;
    return layout;
  }, {});
}

function getStickyStyle(columnKey, stickyLayout, isHeader = false) {
  const config = stickyLayout[columnKey];
  if (!config) return {};

  const visibleKeys = Object.keys(stickyLayout);
  const isLastSticky = visibleKeys[visibleKeys.length - 1] === columnKey;

  return {
    position: "sticky",
    left: `${config.left}px`,
    width: `${config.width}px`,
    minWidth: `${config.width}px`,
    maxWidth: `${config.width}px`,
    zIndex: isHeader ? 8 : 3,
    background: isHeader ? "#e2e8f0" : "#ffffff",
    boxShadow: isLastSticky ? "5px 0 10px rgba(15, 23, 42, 0.09)" : undefined,
  };
}

function getSortValue(row, sortKey) {
  if (sortKey.startsWith("month:")) {
    const monthKey = sortKey.slice("month:".length);
    return Number(row?.monthlySalesC?.[monthKey] || 0);
  }

  if (
    [
      "totalSalesC",
      "latest12MonthsSalesC",
      "sales2024C",
      "sales2025C",
      "sales2026C",
    ].includes(sortKey)
  ) {
    return Number(row?.[sortKey] || 0);
  }

  if (sortKey === "wardNo") return row?.wardNumberLabel || "";
  if (sortKey === "addressLine1") return row?.addressLine1 || "";
  if (sortKey === "town") return row?.town || "";
  if (sortKey === "standNumber") return row?.standNumber || "";

  return row?.meterNo || "";
}

function compareRows(left, right, sortConfig) {
  const comparison = compareNatural(
    getSortValue(left, sortConfig.key),
    getSortValue(right, sortConfig.key),
  );

  return sortConfig.direction === "asc" ? comparison : -comparison;
}

function AggregateHeader({
  label,
  columnKey,
  sortConfig,
  onSort,
  filter,
  onOpenFilter,
}) {
  return (
    <>
      <SortButton
        label={label}
        sortKey={columnKey}
        sortConfig={sortConfig}
        onSort={onSort}
      />
      <SalesRangeFilterButton filter={filter} onClick={onOpenFilter} />
    </>
  );
}

export default function SalesMetersTable({
  rows = [],
  monthKeys = [],
  targetFilter = TARGET_FILTERS.ALL,
  selectedIds,
  onSelectedIdsChange,
}) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [columnVisibility, setColumnVisibility] = useState(
    DEFAULT_COLUMN_VISIBILITY,
  );
  const [showColumnControls, setShowColumnControls] = useState(false);
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [activeRangeFilterKey, setActiveRangeFilterKey] = useState(null);
  const [mapRow, setMapRow] = useState(null);

  const latestMonthKey = monthKeys[0] || "2026-06";
  const stickyLayout = useMemo(
    () => buildStickyLayout(columnVisibility),
    [columnVisibility],
  );

  const visibleConfigurableKeys = useMemo(
    () => getVisibleConfigurableKeys(columnVisibility),
    [columnVisibility],
  );

  const fixedTableWidth = useMemo(() => {
    return Object.values(stickyLayout).reduce(
      (total, config) => total + config.width,
      0,
    );
  }, [stickyLayout]);

  const townOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => String(row?.town || "").trim()).filter(Boolean)),
    ).sort(compareNatural);
  }, [rows]);

  const wardOptions = useMemo(() => {
    return Array.from(
      new Set(
        rows.flatMap((row) =>
          Array.isArray(row?.wardNumbers) ? row.wardNumbers : [],
        ),
      ),
    ).sort(compareNatural);
  }, [rows]);

  useEffect(() => {
    setCurrentPage(1);
  }, [targetFilter]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesMonthlyFilters = monthKeys.every((monthKey) => {
        return matchesSalesRangeFilter(
          row?.monthlySalesC?.[monthKey],
          filters.salesRanges?.[`month:${monthKey}`],
        );
      });

      return (
        matchesTargetFilter(row, targetFilter, latestMonthKey) &&
        includesText(row?.meterNo, filters.meterNo) &&
        (filters.wardNo === "ALL" || row?.wardNumbers?.includes(filters.wardNo)) &&
        includesText(row?.addressLine1, filters.addressLine1) &&
        (filters.town === "ALL" || row?.town === filters.town) &&
        includesText(row?.standNumber, filters.standNumber) &&
        matchesSalesRangeFilter(
          row?.totalSalesC,
          filters.salesRanges?.totalSalesC,
        ) &&
        matchesSalesRangeFilter(
          row?.latest12MonthsSalesC,
          filters.salesRanges?.latest12MonthsSalesC,
        ) &&
        matchesSalesRangeFilter(
          row?.sales2024C,
          filters.salesRanges?.sales2024C,
        ) &&
        matchesSalesRangeFilter(
          row?.sales2025C,
          filters.salesRanges?.sales2025C,
        ) &&
        matchesSalesRangeFilter(
          row?.sales2026C,
          filters.salesRanges?.sales2026C,
        ) &&
        matchesMonthlyFilters
      );
    });
  }, [rows, filters, monthKeys, targetFilter, latestMonthKey]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((left, right) =>
      compareRows(left, right, sortConfig),
    );
  }, [filteredRows, sortConfig]);

  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = totalRows === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalRows);
  const paginatedRows = useMemo(
    () => sortedRows.slice(pageStartIndex, pageEndIndex),
    [sortedRows, pageStartIndex, pageEndIndex],
  );

  const selectedIdSet = selectedIds || new Set();
  const pageIds = paginatedRows.map((row) => row.id).filter(Boolean);

  const hasActiveColumnFilters =
    Boolean(String(filters.meterNo || "").trim()) ||
    filters.wardNo !== "ALL" ||
    Boolean(String(filters.addressLine1 || "").trim()) ||
    filters.town !== "ALL" ||
    Boolean(String(filters.standNumber || "").trim()) ||
    Object.values(filters.salesRanges || {}).some((filter) =>
      isSalesRangeFilterActive(filter),
    );

  const hasActiveFilter =
    targetFilter !== TARGET_FILTERS.ALL || hasActiveColumnFilters;

  const headerSelectionIds = hasActiveFilter
    ? sortedRows.map((row) => row.id).filter(Boolean)
    : pageIds;

  const selectedHeaderScopeCount = headerSelectionIds.reduce(
    (count, id) => count + (selectedIdSet.has(id) ? 1 : 0),
    0,
  );

  const allHeaderScopeRowsSelected =
    headerSelectionIds.length > 0 &&
    selectedHeaderScopeCount === headerSelectionIds.length;

  const someHeaderScopeRowsSelected =
    selectedHeaderScopeCount > 0 && !allHeaderScopeRowsSelected;

  const headerSelectionLabel = hasActiveFilter
    ? `Select all ${formatNumber(headerSelectionIds.length)} filtered meters`
    : `Select all ${formatNumber(headerSelectionIds.length)} meters on this page`;

  function updateFilter(key, value) {
    setCurrentPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyRangeFilter(filterKey, nextFilter) {
    setCurrentPage(1);
    setFilters((current) => ({
      ...current,
      salesRanges: {
        ...current.salesRanges,
        [filterKey]: nextFilter,
      },
    }));
    setActiveRangeFilterKey(null);
  }

  function clearRangeFilter(filterKey) {
    setCurrentPage(1);
    setFilters((current) => {
      const nextSalesRanges = { ...current.salesRanges };
      delete nextSalesRanges[filterKey];

      return {
        ...current,
        salesRanges: nextSalesRanges,
      };
    });
    setActiveRangeFilterKey(null);
  }

  function handleSort(sortKey) {
    setCurrentPage(1);
    setSortConfig((current) => {
      if (current.key !== sortKey) return { key: sortKey, direction: "asc" };
      if (current.direction === "asc") {
        return { key: sortKey, direction: "desc" };
      }
      return DEFAULT_SORT;
    });
  }

  function handlePageChange(nextPage) {
    const normalizedPage = Number(nextPage);
    const clampedPage = Math.max(
      1,
      Math.min(Number.isFinite(normalizedPage) ? normalizedPage : 1, totalPages),
    );
    setCurrentPage(clampedPage);
  }

  function handlePageSizeChange(nextPageSize) {
    const normalizedPageSize = Number(nextPageSize);
    const nextSize = PAGE_SIZE_OPTIONS.includes(normalizedPageSize)
      ? normalizedPageSize
      : DEFAULT_PAGE_SIZE;
    setPageSize(nextSize);
    setCurrentPage(1);
  }

  function toggleRow(rowId) {
    const nextSelected = new Set(selectedIdSet);

    if (nextSelected.has(rowId)) nextSelected.delete(rowId);
    else nextSelected.add(rowId);

    onSelectedIdsChange(nextSelected);
  }

  function toggleHeaderSelection() {
    const nextSelected = new Set(selectedIdSet);

    if (allHeaderScopeRowsSelected) {
      headerSelectionIds.forEach((id) => nextSelected.delete(id));
    } else {
      headerSelectionIds.forEach((id) => nextSelected.add(id));
    }

    onSelectedIdsChange(nextSelected);
  }

  function toggleColumn(columnKey) {
    const willHide = columnVisibility[columnKey] === true;

    setColumnVisibility((current) => ({
      ...current,
      [columnKey]: !current[columnKey],
    }));

    if (!willHide) return;

    setCurrentPage(1);
    setFilters((current) => {
      const nextSalesRanges = { ...current.salesRanges };
      delete nextSalesRanges[columnKey];

      return {
        ...current,
        wardNo: columnKey === "wardNo" ? "ALL" : current.wardNo,
        addressLine1:
          columnKey === "addressLine1" ? "" : current.addressLine1,
        town: columnKey === "town" ? "ALL" : current.town,
        standNumber:
          columnKey === "standNumber" ? "" : current.standNumber,
        salesRanges: nextSalesRanges,
      };
    });

    if (sortConfig.key === columnKey) setSortConfig(DEFAULT_SORT);
  }

  function resetColumnFilters() {
    setFilters(EMPTY_FILTERS);
    setSortConfig(DEFAULT_SORT);
    setCurrentPage(1);
  }

  function getRangeFilterColumnLabel(filterKey) {
    const labels = {
      totalSalesC: "Total Sales",
      latest12MonthsSalesC: "Latest 12 Months",
      sales2024C: "Total Sales 2024",
      sales2025C: "Total Sales 2025",
      sales2026C: "Total Sales 2026",
    };

    if (labels[filterKey]) return labels[filterKey];

    return `${getMonthLabel(filterKey.slice("month:".length))} Sales`;
  }

  const totalColumnCount =
    2 + visibleConfigurableKeys.length + monthKeys.length;

  return (
    <section style={styles.panel}>
      <div style={styles.sectionHeader}>
        <div>
          <p style={styles.eyebrow}>Sales Meters</p>
          <h2 style={styles.sectionTitle}>Monthly meter vending history</h2>
          <p style={styles.sectionSubtitle}>
            {getTargetFilterLabel(targetFilter)} · {formatNumber(totalRows)} of{" "}
            {formatNumber(rows.length)} meters
          </p>
        </div>

        <div style={styles.headerActions}>
          <button
            type="button"
            style={styles.columnsButton}
            onClick={() => setShowColumnControls((current) => !current)}
          >
            {showColumnControls ? "Hide Column Controls" : "Show / Hide Columns"}
          </button>

          <button type="button" style={styles.resetButton} onClick={resetColumnFilters}>
            Reset Column Filters
          </button>
        </div>
      </div>

      {showColumnControls ? (
        <div style={styles.columnControls}>
          <div style={styles.fixedColumnsNote}>
            Always visible: Select, Meter Number and monthly totals
          </div>

          <div style={styles.columnToggleGrid}>
            {COLUMN_OPTIONS.map((option) => (
              <label key={option.key} style={styles.columnToggleLabel}>
                <input
                  type="checkbox"
                  checked={columnVisibility[option.key]}
                  onChange={() => toggleColumn(option.key)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <PaginationControls
        currentPage={safeCurrentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={totalRows}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />

      <div style={styles.tableWrap}>
        <table
          className="data-table"
          style={{
            ...styles.table,
            minWidth: `${fixedTableWidth + monthKeys.length * 122}px`,
          }}
        >
          <thead>
            <tr>
              <th style={{ ...styles.headerCell, ...getStickyStyle("select", stickyLayout, true) }}>
                <input
                  type="checkbox"
                  ref={(checkbox) => {
                    if (checkbox) checkbox.indeterminate = someHeaderScopeRowsSelected;
                  }}
                  checked={allHeaderScopeRowsSelected}
                  onChange={toggleHeaderSelection}
                  disabled={headerSelectionIds.length === 0}
                  aria-label={headerSelectionLabel}
                  title={headerSelectionLabel}
                />
              </th>

              <th style={{ ...styles.headerCell, ...getStickyStyle("meterNo", stickyLayout, true) }}>
                <SortButton
                  label="Meter Number"
                  sortKey="meterNo"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
                <FilterInput
                  value={filters.meterNo}
                  onChange={(value) => updateFilter("meterNo", value)}
                  placeholder="Meter number"
                />
              </th>

              {columnVisibility.wardNo ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("wardNo", stickyLayout, true) }}>
                  <SortButton
                    label="Ward No"
                    sortKey="wardNo"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <select
                    value={filters.wardNo}
                    onChange={(event) => updateFilter("wardNo", event.target.value)}
                    style={styles.headerSelect}
                  >
                    <option value="ALL">All wards</option>
                    {wardOptions.map((wardNo) => (
                      <option key={wardNo} value={wardNo}>
                        Ward {wardNo}
                      </option>
                    ))}
                  </select>
                </th>
              ) : null}

              {columnVisibility.addressLine1 ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("addressLine1", stickyLayout, true) }}>
                  <SortButton
                    label="Address"
                    sortKey="addressLine1"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    value={filters.addressLine1}
                    onChange={(value) => updateFilter("addressLine1", value)}
                    placeholder="Address"
                  />
                </th>
              ) : null}

              {columnVisibility.town ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("town", stickyLayout, true) }}>
                  <SortButton
                    label="Town"
                    sortKey="town"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <select
                    value={filters.town}
                    onChange={(event) => updateFilter("town", event.target.value)}
                    style={styles.headerSelect}
                  >
                    <option value="ALL">All towns</option>
                    {townOptions.map((town) => (
                      <option key={town} value={town}>
                        {town}
                      </option>
                    ))}
                  </select>
                </th>
              ) : null}

              {columnVisibility.standNumber ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("standNumber", stickyLayout, true) }}>
                  <SortButton
                    label="SG Code"
                    sortKey="standNumber"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    value={filters.standNumber}
                    onChange={(value) => updateFilter("standNumber", value)}
                    placeholder="SG code"
                  />
                </th>
              ) : null}

              {columnVisibility.totalSalesC ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("totalSalesC", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Total Sales"
                    columnKey="totalSalesC"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.totalSalesC}
                    onOpenFilter={() => setActiveRangeFilterKey("totalSalesC")}
                  />
                </th>
              ) : null}

              {columnVisibility.latest12MonthsSalesC ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("latest12MonthsSalesC", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Latest 12 Months"
                    columnKey="latest12MonthsSalesC"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.latest12MonthsSalesC}
                    onOpenFilter={() => setActiveRangeFilterKey("latest12MonthsSalesC")}
                  />
                </th>
              ) : null}

              {columnVisibility.sales2024C ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("sales2024C", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Total Sales 2024"
                    columnKey="sales2024C"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.sales2024C}
                    onOpenFilter={() => setActiveRangeFilterKey("sales2024C")}
                  />
                </th>
              ) : null}

              {columnVisibility.sales2025C ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("sales2025C", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Total Sales 2025"
                    columnKey="sales2025C"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.sales2025C}
                    onOpenFilter={() => setActiveRangeFilterKey("sales2025C")}
                  />
                </th>
              ) : null}

              {columnVisibility.sales2026C ? (
                <th style={{ ...styles.headerCell, ...getStickyStyle("sales2026C", stickyLayout, true) }}>
                  <AggregateHeader
                    label="Total Sales 2026"
                    columnKey="sales2026C"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    filter={filters.salesRanges?.sales2026C}
                    onOpenFilter={() => setActiveRangeFilterKey("sales2026C")}
                  />
                </th>
              ) : null}

              {monthKeys.map((monthKey) => (
                <th key={monthKey} style={styles.monthHeaderCell}>
                  <SortButton
                    label={getMonthLabel(monthKey)}
                    sortKey={`month:${monthKey}`}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <SalesRangeFilterButton
                    filter={filters.salesRanges?.[`month:${monthKey}`]}
                    onClick={() => setActiveRangeFilterKey(`month:${monthKey}`)}
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={totalColumnCount} style={styles.noRowsCell}>
                  No sales meters match the current targeting and column filters.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => (
                <tr key={row.id}>
                  <td style={{ ...styles.bodyCell, ...getStickyStyle("select", stickyLayout) }}>
                    <input
                      type="checkbox"
                      checked={selectedIdSet.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`Select meter ${row.meterNo}`}
                    />
                  </td>

                  <td style={{ ...styles.bodyCell, ...styles.meterCell, ...getStickyStyle("meterNo", stickyLayout) }}>
                    <button
                      type="button"
                      style={styles.meterLink}
                      onClick={() => setMapRow(row)}
                      title={`Open meter ${row.meterNo} on map`}
                    >
                      {row.meterNo || "NAv"}
                    </button>
                  </td>

                  {columnVisibility.wardNo ? (
                    <td style={{ ...styles.bodyCell, ...getStickyStyle("wardNo", stickyLayout) }} title={row.wardNumberLabel || "NAv"}>
                      {row.wardNumberLabel || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.addressLine1 ? (
                    <td style={{ ...styles.bodyCell, ...styles.addressCell, ...getStickyStyle("addressLine1", stickyLayout) }} title={row.addressLine1 || "NAv"}>
                      {row.addressLine1 || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.town ? (
                    <td style={{ ...styles.bodyCell, ...getStickyStyle("town", stickyLayout) }}>
                      {row.town || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.standNumber ? (
                    <td style={{ ...styles.bodyCell, ...styles.sgCodeCell, ...getStickyStyle("standNumber", stickyLayout) }} title={row.standNumber || "NAv"}>
                      {row.standNumber || "NAv"}
                    </td>
                  ) : null}

                  {columnVisibility.totalSalesC ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("totalSalesC", stickyLayout) }}>
                      {formatCurrencyFromCents(row.totalSalesC)}
                    </td>
                  ) : null}

                  {columnVisibility.latest12MonthsSalesC ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("latest12MonthsSalesC", stickyLayout) }}>
                      {formatCurrencyFromCents(row.latest12MonthsSalesC)}
                    </td>
                  ) : null}

                  {columnVisibility.sales2024C ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("sales2024C", stickyLayout) }}>
                      {formatCurrencyFromCents(row.sales2024C)}
                    </td>
                  ) : null}

                  {columnVisibility.sales2025C ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("sales2025C", stickyLayout) }}>
                      {formatCurrencyFromCents(row.sales2025C)}
                    </td>
                  ) : null}

                  {columnVisibility.sales2026C ? (
                    <td style={{ ...styles.bodyCell, ...styles.moneyCell, ...getStickyStyle("sales2026C", stickyLayout) }}>
                      {formatCurrencyFromCents(row.sales2026C)}
                    </td>
                  ) : null}

                  {monthKeys.map((monthKey) => (
                    <td key={monthKey} style={{ ...styles.bodyCell, ...styles.moneyCell }}>
                      {formatCurrencyFromCents(row?.monthlySalesC?.[monthKey] || 0)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls
        currentPage={safeCurrentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={totalRows}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />

      {activeRangeFilterKey ? (
        <SalesRangeFilterModal
          columnLabel={getRangeFilterColumnLabel(activeRangeFilterKey)}
          filter={
            filters.salesRanges?.[activeRangeFilterKey] ||
            EMPTY_SALES_RANGE_FILTER
          }
          onApply={(nextFilter) =>
            applyRangeFilter(activeRangeFilterKey, nextFilter)
          }
          onClear={() => clearRangeFilter(activeRangeFilterKey)}
          onClose={() => setActiveRangeFilterKey(null)}
        />
      ) : null}

      {mapRow ? (
        <MeterLocationModal row={mapRow} onClose={() => setMapRow(null)} />
      ) : null}
    </section>
  );
}

const styles = {
  panel: {
    background: "#ffffff",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: "1rem",
    boxShadow: "0 14px 30px rgba(15, 23, 42, 0.06)",
    overflow: "hidden",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem",
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  sectionTitle: {
    margin: "0.2rem 0 0",
    color: "#0f172a",
    fontSize: "1.1rem",
  },
  sectionSubtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
    fontSize: "0.86rem",
  },
  headerActions: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  columnsButton: {
    border: "1px solid #2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.75rem",
    fontWeight: 850,
    cursor: "pointer",
  },
  resetButton: {
    border: "1px solid rgba(148, 163, 184, 0.45)",
    background: "#ffffff",
    color: "#334155",
    borderRadius: "0.7rem",
    padding: "0.55rem 0.75rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  columnControls: {
    display: "grid",
    gap: "0.65rem",
    padding: "0.85rem 1rem",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  fixedColumnsNote: {
    color: "#64748b",
    fontSize: "0.76rem",
    fontWeight: 750,
  },
  columnToggleGrid: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  columnToggleLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    minHeight: "2.1rem",
    padding: "0.38rem 0.58rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.6rem",
    background: "#ffffff",
    color: "#334155",
    fontSize: "0.78rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  tableWrap: {
    width: "100%",
    maxHeight: "64vh",
    overflow: "auto",
    borderTop: "1px solid rgba(148, 163, 184, 0.22)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: "0.82rem",
  },
  headerCell: {
    position: "sticky",
    top: 0,
    zIndex: 6,
    background: "#e2e8f0",
    color: "#0f172a",
    padding: "0.65rem",
    borderRight: "1px solid #cbd5e1",
    borderBottom: "1px solid #cbd5e1",
    textAlign: "left",
    verticalAlign: "top",
  },
  monthHeaderCell: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    width: "122px",
    minWidth: "122px",
    maxWidth: "122px",
    background: "#e2e8f0",
    color: "#0f172a",
    padding: "0.65rem",
    borderRight: "1px solid #cbd5e1",
    borderBottom: "1px solid #cbd5e1",
    textAlign: "left",
    verticalAlign: "top",
  },
  sortButton: {
    width: "100%",
    border: 0,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.4rem",
    padding: 0,
    fontWeight: 900,
    textAlign: "left",
  },
  rangeFilterButton: {
    width: "100%",
    minWidth: 0,
    minHeight: "2rem",
    marginTop: "0.4rem",
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    background: "#ffffff",
    color: "#475569",
    cursor: "pointer",
    boxSizing: "border-box",
    fontSize: "0.72rem",
    fontWeight: 800,
    textAlign: "left",
  },
  rangeFilterButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  rangeFilterCheckbox: {
    flex: "0 0 auto",
    fontSize: "0.85rem",
    lineHeight: 1,
  },
  rangeFilterLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  headerInput: {
    width: "100%",
    minWidth: 0,
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
    boxSizing: "border-box",
  },
  headerSelect: {
    width: "100%",
    minWidth: 0,
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
    boxSizing: "border-box",
  },
  bodyCell: {
    padding: "0.72rem 0.65rem",
    borderRight: "1px solid #e2e8f0",
    borderBottom: "1px solid #e2e8f0",
    color: "#334155",
    background: "#ffffff",
    verticalAlign: "top",
  },
  meterCell: {
    fontWeight: 850,
    color: "#0f172a",
    whiteSpace: "nowrap",
  },
  meterLink: {
    border: 0,
    padding: 0,
    background: "transparent",
    color: "#1d4ed8",
    font: "inherit",
    fontWeight: 900,
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    cursor: "pointer",
  },
  addressCell: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sgCodeCell: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  moneyCell: {
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  noRowsCell: {
    padding: "2rem",
    color: "#64748b",
    textAlign: "center",
  },
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    padding: "0.75rem 0.9rem",
    flexWrap: "wrap",
  },
  paginationSummary: {
    color: "#64748b",
    fontSize: "0.82rem",
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    flexWrap: "wrap",
  },
  pageSizeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    color: "#64748b",
    fontSize: "0.82rem",
    fontWeight: 700,
  },
  pageSizeSelect: {
    border: "1px solid rgba(148, 163, 184, 0.45)",
    borderRadius: "0.55rem",
    padding: "0.34rem 0.45rem",
    fontSize: "0.82rem",
  },
  paginationButton: {
    border: "1px solid rgba(148, 163, 184, 0.42)",
    background: "#fff",
    color: "#0f172a",
    borderRadius: "0.6rem",
    padding: "0.36rem 0.58rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  pageCountLabel: {
    color: "#334155",
    fontSize: "0.82rem",
    fontWeight: 800,
    padding: "0 0.2rem",
  },
};
