/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetRegistryTrnsByLmPcodeQuery } from "../../redux/trnsApi";
import {
  DatetimeFilterButton,
  DatetimeFilterModal,
} from "../../components/DatetimeFilter";
import DownloadButtons from "../../components/DownloadButtons";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;
const DEFAULT_SORT = { key: "createdAt", direction: "desc" };

const TRN_TYPE_OPTIONS = [
  "METER_COMMISSIONING",
  "METER_DISCOVERY",
  "METER_DISCONNECTION",
  "METER_INSPECTION",
  "METER_INSTALLATION",
  "METER_READING",
  "METER_RECONNECTION",
  "METER_REMOVAL",
];

const AST_STATE_OPTIONS = [
  "FIELD",
  "CONNECTED",
  "DISCONNECTED",
  "REMOVED",
  "NAv",
];

const EMPTY_TRN_FILTERS = {
  trnId: "",
  meterNo: "",
  premiseAddress: "",
  erfNo: "",
  wardNo: "",
  mediaCount: "",
  trnType: "ALL",
  hasAccess: "ALL",
  accessReason: "",
  meterType: "ALL",
  astState: "ALL",
  anomaly: "",
  anomalyDetail: "",
  createdByUser: "",
};

const EMPTY_DATETIME_FILTER = {
  mode: "ALL",
  startDate: "",
  endDate: "",
};

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function formatDateTime(value) {
  if (!value || value === "NAv") return "NAv";

  if (typeof value === "string") {
    return value.slice(0, 19).replace("T", " ");
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  return "NAv";
}

function getDateMs(value) {
  if (!value || value === "NAv") return null;

  if (typeof value?.toDate === "function") {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeFilterText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function includesText(value, filterValue) {
  const filterText = normalizeFilterText(filterValue);
  if (!filterText) return true;

  return normalizeFilterText(value).includes(filterText);
}

function matchesSelect(value, selectedValue) {
  if (!selectedValue || selectedValue === "ALL") return true;

  return (
    String(value || "NAv")
      .trim()
      .toUpperCase() === String(selectedValue).trim().toUpperCase()
  );
}

function getRegistryLabel(value) {
  const text = String(value || "")
    .trim()
    .replace(/[_-]+/g, " ");

  if (!text || ["NAV", "NA"].includes(text.toUpperCase())) return "NAv";

  return text
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getAccessLabel(value) {
  const normalized = String(value || "NAv")
    .trim()
    .toUpperCase();
  if (normalized === "YES") return "Yes";
  if (normalized === "NO") return "No";
  return "NAv";
}

function compareNatural(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function isMissingSortValue(value) {
  if (value === null || value === undefined || value === "") return true;
  return String(value).trim().toUpperCase() === "NAV";
}

function getSortValue(row, key) {
  if (key === "wardNo") return Number(row.wardNo);
  if (key === "mediaCount") return Number(row.mediaCount);
  if (key === "createdAt") return getDateMs(row.createdAt);

  return row?.[key] ?? "";
}

function compareRows(leftRow, rightRow, sortConfig) {
  const leftValue = getSortValue(leftRow, sortConfig.key);
  const rightValue = getSortValue(rightRow, sortConfig.key);
  const leftMissing = isMissingSortValue(leftValue) || Number.isNaN(leftValue);
  const rightMissing =
    isMissingSortValue(rightValue) || Number.isNaN(rightValue);

  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  const comparison = compareNatural(leftValue, rightValue);
  return sortConfig.direction === "asc" ? comparison : -comparison;
}

function getDateValue(value) {
  if (!value || value === "NAv") return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
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

function getDateFilterRange(filter = EMPTY_DATETIME_FILTER) {
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

function matchesDateFilter(value, filter = EMPTY_DATETIME_FILTER) {
  if (!filter || filter.mode === "ALL") return true;

  const rowDate = getDateValue(value);
  if (!rowDate) return false;

  const { start, end } = getDateFilterRange(filter);
  if (start && rowDate < start) return false;
  if (end && rowDate > end) return false;

  return true;
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

function GroupHeader({ children, colSpan }) {
  return (
    <th colSpan={colSpan} style={styles.groupHeaderCell}>
      {children}
    </th>
  );
}

export default function TrnsRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const [filters, setFilters] = useState(EMPTY_TRN_FILTERS);
  const [createdAtFilter, setCreatedAtFilter] = useState(EMPTY_DATETIME_FILTER);
  const [isCreatedAtFilterOpen, setIsCreatedAtFilterOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const {
    data: trnRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryTrnsByLmPcodeQuery(activeLmPcode || skipToken);

  const filteredTrnRows = useMemo(() => {
    return trnRows.filter((row) => {
      const mediaFilterIsEmpty = filters.mediaCount === "";
      const mediaFilterValue = Number(filters.mediaCount);
      const mediaMatches =
        mediaFilterIsEmpty ||
        (Number.isFinite(mediaFilterValue) &&
          Number(row.mediaCount) === mediaFilterValue);

      return (
        includesText(row.trnId, filters.trnId) &&
        includesText(row.meterNo, filters.meterNo) &&
        includesText(row.premiseAddress, filters.premiseAddress) &&
        includesText(row.erfNo, filters.erfNo) &&
        includesText(row.wardNo, filters.wardNo) &&
        mediaMatches &&
        matchesSelect(row.trnType, filters.trnType) &&
        matchesSelect(row.hasAccess, filters.hasAccess) &&
        includesText(row.accessReason, filters.accessReason) &&
        matchesSelect(row.meterType, filters.meterType) &&
        matchesSelect(row.astState, filters.astState) &&
        includesText(row.anomaly, filters.anomaly) &&
        includesText(row.anomalyDetail, filters.anomalyDetail) &&
        includesText(row.createdByUser, filters.createdByUser) &&
        matchesDateFilter(row.createdAt, createdAtFilter)
      );
    });
  }, [trnRows, filters, createdAtFilter]);

  const sortedTrnRows = useMemo(() => {
    return [...filteredTrnRows].sort((left, right) =>
      compareRows(left, right, sortConfig),
    );
  }, [filteredTrnRows, sortConfig]);

  const totalRows = sortedTrnRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = totalRows === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalRows);
  const paginatedTrnRows = useMemo(
    () => sortedTrnRows.slice(pageStartIndex, pageEndIndex),
    [sortedTrnRows, pageStartIndex, pageEndIndex],
  );

  const totals = useMemo(() => {
    return sortedTrnRows.reduce(
      (accumulator, row) => {
        if (String(row.hasAccess).toUpperCase() === "YES")
          accumulator.hasAccess += 1;
        if (String(row.hasAccess).toUpperCase() === "NO")
          accumulator.noAccess += 1;
        if (String(row.meterType).toUpperCase() === "ELECTRICITY")
          accumulator.electricity += 1;
        if (String(row.meterType).toUpperCase() === "WATER")
          accumulator.water += 1;
        if (String(row.workflowState).toUpperCase() === "COMPLETED")
          accumulator.completed += 1;
        accumulator.media += Number(row.mediaCount) || 0;
        return accumulator;
      },
      {
        hasAccess: 0,
        noAccess: 0,
        electricity: 0,
        water: 0,
        completed: 0,
        media: 0,
      },
    );
  }, [sortedTrnRows]);

  const quickDownloadColumns = useMemo(
    () => [
      { header: "TRN ID", value: (row) => row.trnId || "NAv" },
      { header: "Meter No", value: (row) => row.meterNo || "NAv" },
      {
        header: "Address",
        value: (row) => row.premiseAddress || "NAv",
      },
      { header: "ERF No", value: (row) => row.erfNo || "NAv" },
      { header: "Ward No", value: (row) => row.wardNo || "NAv" },
      { header: "Media Count", value: (row) => Number(row.mediaCount) || 0 },
      { header: "TRN Type", value: (row) => row.trnType || "NAv" },
      { header: "Has Access", value: (row) => getAccessLabel(row.hasAccess) },
      {
        header: "No Access Reason",
        value: (row) => row.accessReason || "NAv",
      },
      {
        header: "Meter Type",
        value: (row) => getRegistryLabel(row.meterType),
      },
      { header: "AST State", value: (row) => row.astState || "NAv" },
      { header: "Anomaly", value: (row) => row.anomaly || "NAv" },
      {
        header: "Anomaly Detail",
        value: (row) => row.anomalyDetail || "NAv",
      },
      {
        header: "Created By User",
        value: (row) => row.createdByUser || "NAv",
      },
      { header: "Created At", value: (row) => formatDateTime(row.createdAt) },
    ],
    [],
  );

  const quickDownloadScope = useMemo(
    () => ({
      lmName: activeWorkbaseName,
      lmPcode: activeLmPcode || "NAv",
      trnType: filters.trnType === "ALL" ? "All TRN Types" : filters.trnType,
    }),
    [activeWorkbaseName, activeLmPcode, filters.trnType],
  );

  function updateFilter(key, value) {
    setCurrentPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(sortKey) {
    setCurrentPage(1);
    setSortConfig((current) => {
      if (current.key !== sortKey) return { key: sortKey, direction: "asc" };
      if (current.direction === "asc")
        return { key: sortKey, direction: "desc" };
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

  function handleCreatedAtFilterApply(nextFilter) {
    setCurrentPage(1);
    setCreatedAtFilter(nextFilter);
    setIsCreatedAtFilterOpen(false);
  }

  function handleCreatedAtFilterClear() {
    setCurrentPage(1);
    setCreatedAtFilter(EMPTY_DATETIME_FILTER);
    setIsCreatedAtFilterOpen(false);
  }

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>TRN Registry</h1>

          <p className="muted">
            Read-only LM-scoped TRN records from the trns collection.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || "NAv"}</div>
          <div className="role-pill">
            {isFetching
              ? "Streaming..."
              : `${formatNumber(sortedTrnRows.length)} TRNs`}
          </div>
          <DownloadButtons
            registryName="TRN Registry"
            rowsLabel="TRNs"
            visibleRows={sortedTrnRows}
            columns={quickDownloadColumns}
            fileBaseName="trns_registry"
            scope={quickDownloadScope}
          />
        </div>
      </header>

      <section className="filter-panel">
        <label>
          Main TRN Type
          <select
            value={filters.trnType}
            onChange={(event) => updateFilter("trnType", event.target.value)}
          >
            <option value="ALL">ALL</option>
            {TRN_TYPE_OPTIONS.map((trnType) => (
              <option key={trnType} value={trnType}>
                {trnType}
              </option>
            ))}
          </select>
        </label>

        <div className="filter-summary">
          <strong>
            {filters.trnType === "ALL" ? "All TRN Types" : filters.trnType}
          </strong>
          <span>
            {formatNumber(sortedTrnRows.length)} of{" "}
            {formatNumber(trnRows.length)} TRNs
          </span>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>TRNs</span>
          <strong>{formatNumber(trnRows.length)}</strong>
        </div>
        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(sortedTrnRows.length)}</strong>
        </div>
        <div className="stat-card">
          <span>Has Access</span>
          <strong>{formatNumber(totals.hasAccess)}</strong>
        </div>
        <div className="stat-card">
          <span>No Access</span>
          <strong>{formatNumber(totals.noAccess)}</strong>
        </div>
        <div className="stat-card">
          <span>Electricity</span>
          <strong>{formatNumber(totals.electricity)}</strong>
        </div>
        <div className="stat-card">
          <span>Water</span>
          <strong>{formatNumber(totals.water)}</strong>
        </div>
        <div className="stat-card">
          <span>Completed</span>
          <strong>{formatNumber(totals.completed)}</strong>
        </div>
        <div className="stat-card">
          <span>Media Files</span>
          <strong>{formatNumber(totals.media)}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!activeLmPcode ? (
          <div className="empty-state">
            <h2>No active workbase</h2>
            <p className="muted">
              Activate a Local Municipality workbase before opening the TRN
              Registry.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load TRN Registry</h2>
            <p className="muted">
              Check Firestore rules and the accessData.parents.lmPcode field
              used by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading TRN Registry...</h2>
            <p className="muted">Opening the Firestore TRN stream.</p>
          </div>
        ) : null}

        {!isLoading && activeLmPcode && trnRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No TRNs found</h2>
            <p className="muted">
              No TRNs were returned for {activeWorkbaseName}.
            </p>
          </div>
        ) : null}

        {trnRows.length > 0 ? (
          <>
            <PaginationControls
              currentPage={safeCurrentPage}
              pageSize={pageSize}
              totalPages={totalPages}
              totalRows={totalRows}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />

            <div className="table-wrap">
              <table className="data-table" style={styles.registryTable}>
                <thead>
                  <tr>
                    <GroupHeader colSpan={2}>TRN Identity</GroupHeader>
                    <GroupHeader colSpan={5}>Location and Actions</GroupHeader>
                    <GroupHeader colSpan={5}>TRN Detail</GroupHeader>
                    <GroupHeader colSpan={2}>Findings</GroupHeader>
                    <GroupHeader colSpan={2}>Creation</GroupHeader>
                  </tr>

                  <tr>
                    <th>
                      <SortButton
                        label="TRN ID"
                        sortKey="trnId"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        value={filters.trnId}
                        onChange={(value) => updateFilter("trnId", value)}
                        placeholder="TRN ID"
                      />
                    </th>

                    <th>
                      <SortButton
                        label="Meter No"
                        sortKey="meterNo"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        value={filters.meterNo}
                        onChange={(value) => updateFilter("meterNo", value)}
                        placeholder="Meter No"
                      />
                    </th>

                    <th>
                      <SortButton
                        label="Address"
                        sortKey="premiseAddress"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        value={filters.premiseAddress}
                        onChange={(value) =>
                          updateFilter("premiseAddress", value)
                        }
                        placeholder="Address"
                      />
                    </th>

                    <th>
                      <SortButton
                        label="ERF No"
                        sortKey="erfNo"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        value={filters.erfNo}
                        onChange={(value) => updateFilter("erfNo", value)}
                        placeholder="ERF"
                      />
                    </th>

                    <th>
                      <SortButton
                        label="Ward No"
                        sortKey="wardNo"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        value={filters.wardNo}
                        onChange={(value) => updateFilter("wardNo", value)}
                        placeholder="Ward"
                      />
                    </th>

                    <th>
                      <SortButton
                        label="Media"
                        sortKey="mediaCount"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        type="number"
                        min="0"
                        value={filters.mediaCount}
                        onChange={(value) => updateFilter("mediaCount", value)}
                        placeholder="Count"
                      />
                    </th>

                    <th style={styles.iconHeaderCell}>
                      <span style={styles.iconHeaderLabel}>TRN Report</span>
                    </th>

                    <th>
                      <SortButton
                        label="TRN Type"
                        sortKey="trnType"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterSelect
                        value={filters.trnType}
                        onChange={(value) => updateFilter("trnType", value)}
                      >
                        <option value="ALL">ALL</option>
                        {TRN_TYPE_OPTIONS.map((trnType) => (
                          <option key={trnType} value={trnType}>
                            {trnType}
                          </option>
                        ))}
                      </FilterSelect>
                    </th>

                    <th>
                      <SortButton
                        label="Has Access"
                        sortKey="hasAccess"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterSelect
                        value={filters.hasAccess}
                        onChange={(value) => updateFilter("hasAccess", value)}
                      >
                        <option value="ALL">ALL</option>
                        <option value="YES">YES</option>
                        <option value="NO">NO</option>
                      </FilterSelect>
                    </th>

                    <th>
                      <SortButton
                        label="No Access Reason"
                        sortKey="accessReason"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        value={filters.accessReason}
                        onChange={(value) =>
                          updateFilter("accessReason", value)
                        }
                        placeholder="Reason"
                      />
                    </th>

                    <th>
                      <SortButton
                        label="Meter Type"
                        sortKey="meterType"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterSelect
                        value={filters.meterType}
                        onChange={(value) => updateFilter("meterType", value)}
                      >
                        <option value="ALL">ALL</option>
                        <option value="ELECTRICITY">ELECTRICITY</option>
                        <option value="WATER">WATER</option>
                        <option value="NA">NA</option>
                      </FilterSelect>
                    </th>

                    <th>
                      <SortButton
                        label="AST State"
                        sortKey="astState"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterSelect
                        value={filters.astState}
                        onChange={(value) => updateFilter("astState", value)}
                      >
                        <option value="ALL">ALL</option>
                        {AST_STATE_OPTIONS.map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </FilterSelect>
                    </th>

                    <th>
                      <SortButton
                        label="Anomaly"
                        sortKey="anomaly"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        value={filters.anomaly}
                        onChange={(value) => updateFilter("anomaly", value)}
                        placeholder="Anomaly"
                      />
                    </th>

                    <th>
                      <SortButton
                        label="Anomaly Detail"
                        sortKey="anomalyDetail"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        value={filters.anomalyDetail}
                        onChange={(value) =>
                          updateFilter("anomalyDetail", value)
                        }
                        placeholder="Detail"
                      />
                    </th>

                    <th>
                      <SortButton
                        label="Created By User"
                        sortKey="createdByUser"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <FilterInput
                        value={filters.createdByUser}
                        onChange={(value) =>
                          updateFilter("createdByUser", value)
                        }
                        placeholder="User"
                      />
                    </th>

                    <th>
                      <SortButton
                        label="Created At"
                        sortKey="createdAt"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      <DatetimeFilterButton
                        filter={createdAtFilter}
                        onClick={() => setIsCreatedAtFilterOpen(true)}
                      />
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {sortedTrnRows.length === 0 ? (
                    <tr>
                      <td colSpan={16} className="muted">
                        No TRNs match the current filters. Clear or adjust a
                        column filter above.
                      </td>
                    </tr>
                  ) : (
                    paginatedTrnRows.map((row) => (
                      <tr key={row.trnId}>
                        <td style={styles.idCell}>{row.trnId || "NAv"}</td>
                        <td style={styles.meterCell}>{row.meterNo || "NAv"}</td>
                        <td style={styles.addressCell}>
                          {row.premiseAddress || "NAv"}
                        </td>
                        <td>{row.erfNo || "NAv"}</td>
                        <td>{row.wardNo || "NAv"}</td>
                        <td style={styles.iconCell}>
                          <span
                            aria-hidden="true"
                            style={styles.actionIcon}
                            title="Media gallery will be enabled in the next step"
                          >
                            📷
                          </span>
                          <strong>{formatNumber(row.mediaCount)}</strong>
                        </td>
                        <td style={styles.iconCell}>
                          <span
                            aria-hidden="true"
                            style={styles.actionIcon}
                            title="TRN Report preview will be enabled in the next step"
                          >
                            📄
                          </span>
                        </td>
                        <td>{row.trnType || "NAv"}</td>
                        <td>{getAccessLabel(row.hasAccess)}</td>
                        <td>{row.accessReason || "NAv"}</td>
                        <td>{getRegistryLabel(row.meterType)}</td>
                        <td>{row.astState || "NAv"}</td>
                        <td style={styles.findingCell}>
                          {row.anomaly || "NAv"}
                        </td>
                        <td style={styles.findingCell}>
                          {row.anomalyDetail || "NAv"}
                        </td>
                        <td>{row.createdByUser || "NAv"}</td>
                        <td>{formatDateTime(row.createdAt)}</td>
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
          </>
        ) : null}
      </section>

      {isCreatedAtFilterOpen ? (
        <DatetimeFilterModal
          filter={createdAtFilter}
          onApply={handleCreatedAtFilterApply}
          onClear={handleCreatedAtFilterClear}
          onClose={() => setIsCreatedAtFilterOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = {
  fixedRegistryHeader: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "#f8fafc",
    paddingTop: "0.35rem",
    paddingRight: "1.25rem",
    paddingBottom: "0.85rem",
    paddingLeft: "1.25rem",
    boxSizing: "border-box",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
  },
  registryTable: {
    minWidth: "2600px",
  },
  groupHeaderCell: {
    background: "#e2e8f0",
    color: "#0f172a",
    textAlign: "center",
    fontSize: "0.78rem",
    fontWeight: 900,
    letterSpacing: "0.035em",
    textTransform: "uppercase",
    borderRight: "2px solid #cbd5e1",
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
    minWidth: "8rem",
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    boxSizing: "border-box",
  },
  headerSelect: {
    width: "100%",
    minWidth: "8rem",
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
    boxSizing: "border-box",
  },
  iconHeaderCell: {
    minWidth: "7rem",
    textAlign: "center",
    verticalAlign: "top",
  },
  iconHeaderLabel: {
    display: "inline-block",
    fontWeight: 900,
    paddingTop: "0.1rem",
  },
  idCell: {
    minWidth: "19rem",
    maxWidth: "25rem",
    overflowWrap: "anywhere",
    fontWeight: 750,
  },
  meterCell: {
    minWidth: "10rem",
    fontWeight: 800,
  },
  addressCell: {
    minWidth: "15rem",
    maxWidth: "22rem",
    whiteSpace: "normal",
  },
  findingCell: {
    minWidth: "12rem",
    maxWidth: "20rem",
    whiteSpace: "normal",
  },
  iconCell: {
    minWidth: "6rem",
    textAlign: "center",
    whiteSpace: "nowrap",
  },
  actionIcon: {
    display: "inline-block",
    marginRight: "0.35rem",
    fontSize: "1rem",
    lineHeight: 1,
    verticalAlign: "middle",
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
};
