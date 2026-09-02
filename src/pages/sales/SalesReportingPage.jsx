import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import {
  DatetimeFilterButton,
  DatetimeFilterModal,
  EMPTY_DATETIME_FILTER,
} from "../../components/DatetimeFilter";
import { useGetTargetedBatchHeadersByLmQuery } from "../../redux/salesTargetedBatchApi";

const ALL_FILTER = "ALL";
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;
const DEFAULT_SORT = { key: "createdAt", direction: "desc" };

const EMPTY_FILTERS = {
  batchId: "",
  ward: ALL_FILTER,
  allocation: ALL_FILTER,
  acceptance: ALL_FILTER,
  totalRows: "",
  notStarted: "",
  inProgress: "",
  completed: "",
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

function getActiveLmPcode(activeWorkbase) {
  return cleanText(
    activeWorkbase?.lmPcode ||
      activeWorkbase?.pcode ||
      activeWorkbase?.id ||
      activeWorkbase?.localMunicipalityId,
  );
}

function getActiveWorkbaseName(activeWorkbase) {
  return cleanText(
    activeWorkbase?.name ||
      activeWorkbase?.lmName ||
      activeWorkbase?.id ||
      activeWorkbase?.pcode ||
      "NAv",
  );
}

function formatDateTime(value) {
  const millis = Number(value || 0);
  if (!Number.isFinite(millis) || millis <= 0) return "NAv";

  return new Date(millis).toLocaleString();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function compareNatural(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function includesText(value, filterValue) {
  const normalizedFilter = normalizeUpper(filterValue);
  if (!normalizedFilter) return true;
  return normalizeUpper(value).includes(normalizedFilter);
}

function matchesNumberFilter(value, filterValue) {
  const normalizedFilter = cleanText(filterValue);
  if (!normalizedFilter) return true;

  const expected = Number(normalizedFilter);
  if (!Number.isFinite(expected)) return false;
  return Number(value || 0) === expected;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort(compareNatural);
}

function getAllocationLabel(batch = {}) {
  return cleanText(batch?.allocation?.targetName) || "Unallocated";
}

function getLastActivityDate(value) {
  const millis = Number(value || 0);
  if (!Number.isFinite(millis) || millis <= 0) return null;

  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
}

function endOfDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

function addDays(date, days) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    0,
    0,
    0,
    0,
  );
}

function parseDateOnly(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDatetimeFilterRange(filter = EMPTY_DATETIME_FILTER) {
  const mode = filter?.mode || "ALL";
  const now = new Date();
  const todayStart = startOfDay(now);

  if (mode === "TODAY") {
    return { start: todayStart, end: endOfDay(now) };
  }

  if (mode === "YESTERDAY") {
    const yesterday = addDays(todayStart, -1);
    return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }

  if (mode === "PAST_3_DAYS") {
    return { start: addDays(todayStart, -2), end: endOfDay(now) };
  }

  if (mode === "THIS_WEEK") {
    const sunday = addDays(todayStart, -todayStart.getDay());
    const saturday = addDays(sunday, 6);
    return { start: startOfDay(sunday), end: endOfDay(saturday) };
  }

  if (mode === "THIS_MONTH") {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const lastDay = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    return { start: firstDay, end: lastDay };
  }

  if (mode === "CUSTOM") {
    const startDate = parseDateOnly(filter?.startDate);
    const endDate = parseDateOnly(filter?.endDate);

    return {
      start: startDate ? startOfDay(startDate) : null,
      end: endDate ? endOfDay(endDate) : null,
    };
  }

  return { start: null, end: null };
}

function matchesDatetimeFilter(value, filter = EMPTY_DATETIME_FILTER) {
  if (!filter || filter.mode === "ALL") return true;

  const rowDate = getLastActivityDate(value);
  if (!rowDate) return false;

  const { start, end } = getDatetimeFilterRange(filter);
  if (start && rowDate < start) return false;
  if (end && rowDate > end) return false;

  return true;
}

function getSortValue(batch, key) {
  const progress = batch?.progress || {};

  if (key === "batchId") return cleanText(batch?.id);
  if (key === "ward") return cleanText(batch?.scope?.wardLabel) || "NAv";
  if (key === "allocation") return getAllocationLabel(batch);
  if (key === "acceptance") {
    return cleanText(batch?.acceptance?.status) || "NOT_READY";
  }
  if (key === "totalRows") return Number(progress?.total || 0);
  if (key === "notStarted") return Number(progress?.notStarted || 0);
  if (key === "inProgress") return Number(progress?.inProgress || 0);
  if (key === "completed") return Number(progress?.completed || 0);
  if (key === "lastActivity") return Number(batch?.lastActivityAtMs || 0);
  if (key === "createdAt") return Number(batch?.createdAtMs || 0);

  return "";
}

function statusTone(status = "") {
  switch (normalizeUpper(status)) {
    case "ACCEPTED":
    case "COMPLETED":
    case "ALLOCATED":
      return "success";
    case "IN_PROGRESS":
    case "WAITING":
    case "WAITING_ACCEPTANCE":
      return "warning";
    case "REJECTED":
    case "FAILED":
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}

function StatusBadge({ value }) {
  const tone = statusTone(value);

  return (
    <span
      style={{
        ...styles.badge,
        ...(tone === "success" ? styles.badgeSuccess : null),
        ...(tone === "warning" ? styles.badgeWarning : null),
        ...(tone === "danger" ? styles.badgeDanger : null),
      }}
    >
      {cleanText(value).replaceAll("_", " ") || "NAv"}
    </span>
  );
}

function AllocationCell({ allocation = {} }) {
  const targetName = cleanText(allocation?.targetName);

  if (!targetName) return "Unallocated";

  const targetType = normalizeUpper(allocation?.targetType);
  let targetTypeLabel = cleanText(allocation?.targetType).replaceAll("_", " ");

  if (targetType === "TEAM") targetTypeLabel = "Team";
  if (targetType === "SP" || targetType === "SERVICE_PROVIDER") {
    targetTypeLabel = "SP";
  }
  if (!targetTypeLabel) targetTypeLabel = "Target";

  return (
    <div style={styles.allocationCell}>
      <span style={styles.allocationType}>{targetTypeLabel}</span>
      <span style={styles.allocationName}>{targetName}</span>
    </div>
  );
}

function SummaryCard({ label, value, helper }) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{formatNumber(value)}</strong>
      <span style={styles.summaryHelper}>{helper}</span>
    </article>
  );
}

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

function FilterInput({ value, onChange, placeholder, type = "text", min }) {
  return (
    <input
      type={type}
      min={min}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={styles.headerInput}
    />
  );
}

function FilterSelect({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={styles.headerSelect}
    >
      {children}
    </select>
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
      <div className="muted">
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

function MapIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
      <path d="M9 3v15" />
      <path d="M15 6v15" />
    </svg>
  );
}

export default function SalesReportingPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const {
    data: targetedBatchStream,
    isError: isTargetedBatchQueryError,
    error: targetedBatchQueryError,
  } = useGetTargetedBatchHeadersByLmQuery(activeLmPcode || skipToken);

  const batches = useMemo(
    () =>
      Array.isArray(targetedBatchStream?.items)
        ? targetedBatchStream.items
        : [],
    [targetedBatchStream],
  );

  const streamStatus = cleanText(targetedBatchStream?.sync?.status);
  const streamReady =
    !activeLmPcode ||
    streamStatus === "ready" ||
    streamStatus === "error" ||
    isTargetedBatchQueryError;
  const streamError =
    targetedBatchStream?.sync?.error ||
    (isTargetedBatchQueryError
      ? {
          message:
            targetedBatchQueryError?.error ||
            targetedBatchQueryError?.data?.message ||
            "The live reporting stream could not be opened.",
        }
      : null);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [lastActivityFilter, setLastActivityFilter] = useState(
    EMPTY_DATETIME_FILTER,
  );
  const [isLastActivityFilterOpen, setIsLastActivityFilterOpen] =
    useState(false);
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const filterOptions = useMemo(
    () => ({
      wards: unique(
        batches.map((batch) => cleanText(batch?.scope?.wardLabel) || "NAv"),
      ),
      allocations: unique(batches.map((batch) => getAllocationLabel(batch))),
      acceptanceStatuses: unique(
        batches.map(
          (batch) => cleanText(batch?.acceptance?.status) || "NOT_READY",
        ),
      ),
    }),
    [batches],
  );

  const filteredBatches = useMemo(() => {
    return batches.filter((batch) => {
      const progress = batch?.progress || {};
      const ward = cleanText(batch?.scope?.wardLabel) || "NAv";
      const allocation = getAllocationLabel(batch);
      const acceptanceStatus =
        cleanText(batch?.acceptance?.status) || "NOT_READY";

      return (
        includesText(batch?.id, filters.batchId) &&
        (filters.ward === ALL_FILTER || ward === filters.ward) &&
        (filters.allocation === ALL_FILTER ||
          allocation === filters.allocation) &&
        (filters.acceptance === ALL_FILTER ||
          acceptanceStatus === filters.acceptance) &&
        matchesNumberFilter(progress?.total, filters.totalRows) &&
        matchesNumberFilter(progress?.notStarted, filters.notStarted) &&
        matchesNumberFilter(progress?.inProgress, filters.inProgress) &&
        matchesNumberFilter(progress?.completed, filters.completed) &&
        matchesDatetimeFilter(batch?.lastActivityAtMs, lastActivityFilter)
      );
    });
  }, [batches, filters, lastActivityFilter]);

  const sortedBatches = useMemo(() => {
    const rows = [...filteredBatches];

    rows.sort((left, right) => {
      const comparison = compareNatural(
        getSortValue(left, sortConfig.key),
        getSortValue(right, sortConfig.key),
      );
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [filteredBatches, sortConfig]);

  const totalRows = sortedBatches.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex =
    totalRows === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalRows);
  const paginatedBatches = useMemo(
    () => sortedBatches.slice(pageStartIndex, pageEndIndex),
    [sortedBatches, pageStartIndex, pageEndIndex],
  );

  const summary = useMemo(() => {
    return batches.reduce(
      (accumulator, batch) => {
        const progress = batch?.progress || {};

        accumulator.batches += 1;
        accumulator.rows += Number(progress?.total || 0);
        accumulator.inProgress += Number(progress?.inProgress || 0);
        accumulator.completed += Number(progress?.completed || 0);

        return accumulator;
      },
      {
        batches: 0,
        rows: 0,
        inProgress: 0,
        completed: 0,
      },
    );
  }, [batches]);

  function updateFilter(key, value) {
    setCurrentPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
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
      Math.min(
        Number.isFinite(normalizedPage) ? normalizedPage : 1,
        totalPages,
      ),
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

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setLastActivityFilter(EMPTY_DATETIME_FILTER);
    setSortConfig(DEFAULT_SORT);
    setCurrentPage(1);
  }

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Sales / Reporting</p>
          <h1 style={styles.title}>Sales Reporting</h1>
          <p style={styles.subtitle}>
            One live reporting row per permanent Targeted Batch. Open a batch
            to inspect its field outcomes row by row.
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link to="/sales/allocation-matrix" style={styles.matrixButton}>
            Allocation Matrix
          </Link>
          <div style={styles.liveBadge}>
            <span style={styles.liveDot} />
            Live Targeted Batches
          </div>
        </div>
      </header>

      {!activeLmPcode ? (
        <div style={styles.notice}>
          Activate a Local Municipality workbase before opening Sales
          Reporting.
        </div>
      ) : null}

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Targeted Batches"
          value={summary.batches}
          helper={activeWorkbaseName}
        />
        <SummaryCard
          label="Sales Rows"
          value={summary.rows}
          helper="Across all visible batches"
        />
        <SummaryCard
          label="In Progress"
          value={summary.inProgress}
          helper="Rows active in the field"
        />
        <SummaryCard
          label="Completed"
          value={summary.completed}
          helper="Rows completed in the field"
        />
      </div>

      <section className="table-panel" style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h2 style={styles.panelTitle}>Targeted Batch Reports</h2>
            <p style={styles.panelSubtitle}>
              Use the filters directly under each table heading.
            </p>
          </div>

          <div style={styles.panelHeaderActions}>
            <strong style={styles.resultCount}>
              {formatNumber(sortedBatches.length)} shown
            </strong>
            <button
              type="button"
              className="ghost-button"
              style={styles.clearButton}
              onClick={clearFilters}
            >
              Clear Filters
            </button>
          </div>
        </div>

        {streamReady && !streamError && totalRows > 0 ? (
          <PaginationControls
            currentPage={safeCurrentPage}
            pageSize={pageSize}
            totalPages={totalPages}
            totalRows={totalRows}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        ) : null}

        <div className="table-wrap">
          <table className="data-table" style={styles.table}>
            <thead>
              <tr>
                <th>
                  <SortButton
                    label="Targeted Batch ID"
                    sortKey="batchId"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    value={filters.batchId}
                    onChange={(value) => updateFilter("batchId", value)}
                    placeholder="TB ID"
                  />
                </th>
                <th>
                  <SortButton
                    label="Ward"
                    sortKey="ward"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterSelect
                    value={filters.ward}
                    onChange={(value) => updateFilter("ward", value)}
                  >
                    <option value={ALL_FILTER}>All</option>
                    {filterOptions.wards.map((ward) => (
                      <option key={ward} value={ward}>
                        {ward}
                      </option>
                    ))}
                  </FilterSelect>
                </th>
                <th>
                  <SortButton
                    label="Allocated To"
                    sortKey="allocation"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterSelect
                    value={filters.allocation}
                    onChange={(value) => updateFilter("allocation", value)}
                  >
                    <option value={ALL_FILTER}>All</option>
                    {filterOptions.allocations.map((allocation) => (
                      <option key={allocation} value={allocation}>
                        {allocation}
                      </option>
                    ))}
                  </FilterSelect>
                </th>
                <th>
                  <SortButton
                    label="Acceptance"
                    sortKey="acceptance"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterSelect
                    value={filters.acceptance}
                    onChange={(value) => updateFilter("acceptance", value)}
                  >
                    <option value={ALL_FILTER}>All</option>
                    {filterOptions.acceptanceStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status.replaceAll("_", " ")}
                      </option>
                    ))}
                  </FilterSelect>
                </th>
                <th>
                  <SortButton
                    label="Total Rows"
                    sortKey="totalRows"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    type="number"
                    min="0"
                    value={filters.totalRows}
                    onChange={(value) => updateFilter("totalRows", value)}
                    placeholder="Count"
                  />
                </th>
                <th>
                  <SortButton
                    label="Not Started"
                    sortKey="notStarted"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    type="number"
                    min="0"
                    value={filters.notStarted}
                    onChange={(value) => updateFilter("notStarted", value)}
                    placeholder="Count"
                  />
                </th>
                <th>
                  <SortButton
                    label="In Progress"
                    sortKey="inProgress"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    type="number"
                    min="0"
                    value={filters.inProgress}
                    onChange={(value) => updateFilter("inProgress", value)}
                    placeholder="Count"
                  />
                </th>
                <th>
                  <SortButton
                    label="Completed"
                    sortKey="completed"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    type="number"
                    min="0"
                    value={filters.completed}
                    onChange={(value) => updateFilter("completed", value)}
                    placeholder="Count"
                  />
                </th>
                <th style={styles.actionHeaderCell}>
                  <span style={styles.actionHeaderLabel}>Report</span>
                </th>
                <th>
                  <SortButton
                    label="Last Activity"
                    sortKey="lastActivity"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <DatetimeFilterButton
                    filter={lastActivityFilter}
                    fieldLabel="Last Activity"
                    onClick={() => setIsLastActivityFilterOpen(true)}
                  />
                </th>
              </tr>
            </thead>

            <tbody>
              {!streamReady ? (
                <tr>
                  <td colSpan={10}>
                    <div style={styles.loadingState}>
                      <span style={styles.spinner} />
                      Loading live Targeted Batch reports...
                    </div>
                  </td>
                </tr>
              ) : null}

              {streamReady && streamError ? (
                <tr>
                  <td colSpan={10}>
                    <div style={styles.errorState}>
                      <strong>Targeted Batch report stream failed.</strong>
                      <span>
                        {streamError?.message ||
                          "The live reporting stream could not be opened."}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : null}

              {streamReady && !streamError && sortedBatches.length === 0 ? (
                <tr>
                  <td colSpan={10} className="muted">
                    {batches.length === 0
                      ? "No permanent Targeted Batches exist in this workbase yet."
                      : "No Targeted Batches match the selected column filters."}
                  </td>
                </tr>
              ) : null}

              {streamReady &&
                !streamError &&
                paginatedBatches.map((batch) => {
                  const progress = batch?.progress || {};
                  const ward = cleanText(batch?.scope?.wardLabel) || "NAv";

                  return (
                    <tr key={batch.id}>
                      <td>
                        <div style={styles.batchIdCell}>
                          <Link
                            to={`/sales/reporting/${encodeURIComponent(batch.id)}/map`}
                            style={styles.batchMapIconButton}
                            aria-label={`View Batch Map for ${batch.id}`}
                            title="View Batch Map"
                          >
                            <MapIcon />
                          </Link>
                          <strong style={styles.batchId}>{batch.id}</strong>
                        </div>
                      </td>
                      <td>
                        <strong>{ward}</strong>
                      </td>
                      <td>
                        <AllocationCell allocation={batch?.allocation} />
                      </td>
                      <td>
                        <StatusBadge value={batch?.acceptance?.status} />
                      </td>
                      <td>{formatNumber(progress?.total)}</td>
                      <td>{formatNumber(progress?.notStarted)}</td>
                      <td>{formatNumber(progress?.inProgress)}</td>
                      <td>{formatNumber(progress?.completed)}</td>
                      <td>
                        <Link
                          to={`/sales/reporting/${encodeURIComponent(batch.id)}`}
                          style={styles.openButton}
                        >
                          Open Report
                        </Link>
                      </td>
                      <td>{formatDateTime(batch?.lastActivityAtMs)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {streamReady && !streamError && totalRows > 0 ? (
          <PaginationControls
            currentPage={safeCurrentPage}
            pageSize={pageSize}
            totalPages={totalPages}
            totalRows={totalRows}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        ) : null}
      </section>

      {isLastActivityFilterOpen ? (
        <DatetimeFilterModal
          filter={lastActivityFilter}
          fieldLabel="Last Activity"
          onApply={(nextFilter) => {
            setCurrentPage(1);
            setLastActivityFilter(nextFilter);
            setIsLastActivityFilterOpen(false);
          }}
          onClear={() => {
            setCurrentPage(1);
            setLastActivityFilter(EMPTY_DATETIME_FILTER);
            setIsLastActivityFilterOpen(false);
          }}
          onClose={() => setIsLastActivityFilterOpen(false)}
        />
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 18,
  },

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  title: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: 30,
    lineHeight: 1.15,
  },

  subtitle: {
    maxWidth: 760,
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.6,
  },

  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  matrixButton: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 38,
    borderRadius: 10,
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#ffffff",
    padding: "0 13px",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 900,
  },

  liveBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
    padding: "9px 12px",
    fontSize: 12,
    fontWeight: 900,
  },

  liveDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#16a34a",
  },

  notice: {
    borderRadius: 14,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    padding: 14,
    fontWeight: 800,
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 12,
  },

  summaryCard: {
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    padding: 16,
    display: "grid",
    gap: 4,
  },

  summaryLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  summaryValue: {
    color: "#0f172a",
    fontSize: 26,
    lineHeight: 1.1,
  },

  summaryHelper: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: 700,
  },

  panel: {
    minWidth: 0,
  },

  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: 18,
    borderBottom: "1px solid #e2e8f0",
  },

  panelHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  panelTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 18,
  },

  panelSubtitle: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 700,
  },

  resultCount: {
    color: "#1d4ed8",
    fontSize: 12,
  },

  clearButton: {
    minHeight: 36,
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    padding: "7px 12px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
  },

  table: {
    minWidth: 1460,
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

  headerInput: {
    width: "100%",
    minWidth: "7.5rem",
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    boxSizing: "border-box",
  },

  headerSelect: {
    width: "100%",
    minWidth: "7.5rem",
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
    boxSizing: "border-box",
  },

  actionHeaderCell: {
    verticalAlign: "top",
  },

  actionHeaderLabel: {
    display: "block",
    paddingTop: 1,
  },

  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    padding: "0.75rem 0.9rem",
    flexWrap: "wrap",
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

  batchId: {
    color: "#0f172a",
    whiteSpace: "nowrap",
  },

  allocationCell: {
    display: "grid",
    gap: 2,
    lineHeight: 1.25,
  },

  allocationType: {
    color: "#475569",
    fontSize: 10,
    fontWeight: 900,
  },

  allocationName: {
    color: "#334155",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },

  badge: {
    display: "inline-flex",
    borderRadius: 999,
    background: "#f1f5f9",
    color: "#475569",
    padding: "5px 8px",
    fontSize: 9,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  badgeSuccess: {
    background: "#dcfce7",
    color: "#166534",
  },

  badgeWarning: {
    background: "#ffedd5",
    color: "#c2410c",
  },

  badgeDanger: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  openButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
    borderRadius: 10,
    background: "#0f172a",
    color: "#ffffff",
    padding: "6px 11px",
    fontSize: 10,
    fontWeight: 900,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },

  batchIdCell: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
  },

  batchMapIconButton: {
    width: 30,
    height: 30,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    borderRadius: 9,
    border: "1px solid #93c5fd",
    background: "#eff6ff",
    color: "#1d4ed8",
    textDecoration: "none",
  },

  loadingState: {
    display: "inline-flex",
    alignItems: "center",
    gap: 9,
    color: "#475569",
    fontWeight: 800,
  },

  spinner: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "2px solid #bfdbfe",
    borderTopColor: "#2563eb",
    animation: "spin 0.8s linear infinite",
  },

  errorState: {
    display: "grid",
    gap: 4,
    color: "#991b1b",
  },
};
