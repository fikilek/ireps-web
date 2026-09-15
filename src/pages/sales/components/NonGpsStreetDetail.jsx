/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";

import { formatNumber } from "../salesUtils";
import NonGpsBatchingSummary from "./NonGpsBatchingSummary";
import "./NonGpsKpi.css";
import NonGpsQuickSelect from "./NonGpsQuickSelect";
import SalesTargetedBatchDetailsModal from "./SalesTargetedBatchDetailsModal";
import {
  getSalesTargetedBatchMembershipLabel,
  getSalesTargetedBatchMembershipFilterKey,
} from "../models/salesTargetedBatchMembershipModel";
import { SALES_STATUSES } from "../models/salesStatusModel";
import { NGP_SELECTION_MAX } from "../models/nonGpsBatchPlanningModel";
import { REASONS_SHOWN_IN_COLUMNS } from "../models/sales-table-meter-note";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;

const EMPTY_FILTERS = Object.freeze({
  address: "",
  meterNo: "",
  salesStatus: "",
  batchId: "",
});

function salesStatusStyle(status) {
  if (status === SALES_STATUSES.NOT_STARTED) {
    return { background: "#eff6ff", color: "#1d4ed8" };
  }

  if (status === SALES_STATUSES.IN_PROGRESS) {
    return { background: "#fef3c7", color: "#92400e" };
  }

  if (status === SALES_STATUSES.COMPLETED) {
    return { background: "#dcfce7", color: "#166534" };
  }

  return { background: "#f1f5f9", color: "#475569" };
}

function includesSearch(target, searchText) {
  const needle = String(searchText || "").trim().toLowerCase();
  if (!needle) return true;

  return [
    target?.canonicalAddress,
    target?.meterNo,
    target?.salesWorkStatus,
    getSalesTargetedBatchMembershipLabel(target?.membership),
  ].some((value) => String(value || "").toLowerCase().includes(needle));
}

function includesFilter(value, filterValue) {
  const needle = String(filterValue || "").trim().toLowerCase();
  if (!needle) return true;
  return String(value || "").toLowerCase().includes(needle);
}

function compareValues(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const active = sortConfig.key === sortKey;
  const indicator = active
    ? sortConfig.direction === "asc"
      ? "↑"
      : "↓"
    : "↕";

  return (
    <button
      type="button"
      style={{
        ...styles.sortButton,
        ...(active ? styles.sortButtonActive : null),
      }}
      onClick={() => onSort(sortKey)}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span aria-hidden="true">{indicator}</span>
    </button>
  );
}

function ColumnFilter({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={styles.headerInput}
      aria-label={placeholder}
    />
  );
}

function SalesStatusFilter({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={styles.headerInput}
      aria-label="Filter Sales Meter Status"
    >
      <option value="">All statuses</option>
      <option value={SALES_STATUSES.NOT_STARTED}>NOT_STARTED</option>
      <option value={SALES_STATUSES.IN_PROGRESS}>IN_PROGRESS</option>
      <option value={SALES_STATUSES.COMPLETED}>COMPLETED</option>
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

function getSortValue(target, key) {
  if (key === "address") return target?.canonicalAddress || "";
  if (key === "meterNo") return target?.meterNo || "";
  if (key === "salesStatus") return target?.salesWorkStatus || "";
  if (key === "batchId") return getSalesTargetedBatchMembershipLabel(target?.membership);
  return target?.canonicalAddress || "";
}

function filterTargets(targets, filters, searchText) {
  return targets.filter(
    (target) =>
      includesSearch(target, searchText) &&
      includesFilter(target.canonicalAddress, filters.address) &&
      includesFilter(target.meterNo, filters.meterNo) &&
      (!filters.salesStatus || target.salesWorkStatus === filters.salesStatus) &&
      (!filters.batchId || getSalesTargetedBatchMembershipFilterKey(target.membership) === filters.batchId),
  );
}

function sortTargets(rows, sortConfig) {
  return [...rows].sort((left, right) => {
    const comparison = compareValues(
      getSortValue(left, sortConfig.key),
      getSortValue(right, sortConfig.key),
    );
    const stableComparison = comparison || compareValues(left.id, right.id);
    return sortConfig.direction === "asc" ? stableComparison : -stableComparison;
  });
}

// Quick select always ticks in address order, smallest number first.
const QUICK_SELECT_SORT = Object.freeze({ key: "address", direction: "asc" });

export default function NonGpsStreetDetail({
  street,
  lmPcode = "",
  selectedIds = new Set(),
  onToggleTarget,
  onQuickSelect,
  onBack,
}) {
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortConfig, setSortConfig] = useState({
    key: "address",
    direction: "asc",
  });
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [openBatch, setOpenBatch] = useState(null);
  const [quickSelectNotice, setQuickSelectNotice] = useState("");
  const openTarget = openBatch && street.targets.find((target) => target.id === openBatch.salesId);
  const openBatchIsCurrent = openTarget?.membership?.state === "MEMBER" &&
    openTarget.membership.tbId === openBatch?.tbId && openBatch.lmPcode === lmPcode;
  // Clear invalid dialog state during render, before children can show stale
  // membership. A later membership change must not reopen an old dialog.
  if (openBatch && !openBatchIsCurrent) setOpenBatch(null);

  const batchOptions = useMemo(() => {
    const ids = new Map();
    street.targets.forEach((target) => {
      if (target.membership?.state === "MEMBER") {
        ids.set(getSalesTargetedBatchMembershipFilterKey(target.membership),
          getSalesTargetedBatchMembershipLabel(target.membership));
      }
    });
    return [...ids].sort((left, right) => compareValues(left[1], right[1]));
  }, [street.targets]);

  const filteredTargets = useMemo(
    () => sortTargets(filterTargets(street.targets, filters, searchText), sortConfig),
    [filters, searchText, sortConfig, street.targets],
  );

  const totalPages = Math.max(1, Math.ceil(filteredTargets.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedTargets = filteredTargets.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  function updateSort(key) {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
    setPage(1);
  }

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function handleSearchChange(value) {
    setSearchText(value);
    setPage(1);
  }

  // Ticks the first `count` meters of the filtered list in address order, the
  // same rows the table shows after the sort, across every page.
  function handleQuickSelect(count) {
    const orderedTargets = sortTargets(
      filterTargets(street.targets, filters, searchText),
      QUICK_SELECT_SORT,
    );
    setSortConfig(QUICK_SELECT_SORT);
    setPage(1);
    setQuickSelectNotice(
      onQuickSelect?.({ streetTargets: street.targets, orderedTargets, count }) || "",
    );
  }

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <button type="button" style={styles.backButton} onClick={onBack}>
            ← Back to streets
          </button>
          <p style={styles.eyebrow}>Street Detail</p>
          <h2 style={styles.title}>
            {street.town} / {street.streetLabel || "Unnamed street"}
          </h2>
          <p style={styles.subtitle}>
            The complete street population remains visible. Only batchable Sales
            meters can be selected for the current 1–{NGP_SELECTION_MAX} meter batch.
          </p>
        </div>

        <input
          type="search"
          value={searchText}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder="Search meter, status or address"
          style={styles.searchInput}
        />
      </div>

      <div className="non-gps-kpi-section">
        <p className="non-gps-kpi-heading">SALES METER STATUS</p>
        <div className="non-gps-kpi-grid">
          <div className="non-gps-kpi-card">
            <span className="non-gps-kpi-label">Meters</span>
            <strong className="non-gps-kpi-value">
              {formatNumber(street.counters.total)}
            </strong>
          </div>
          <div className="non-gps-kpi-card">
            <span className="non-gps-kpi-label">Not Started</span>
            <strong className="non-gps-kpi-value">
              {formatNumber(street.counters.notStarted)}
            </strong>
          </div>
          <div className="non-gps-kpi-card">
            <span className="non-gps-kpi-label">In Progress</span>
            <strong className="non-gps-kpi-value">
              {formatNumber(street.counters.inProgress)}
            </strong>
          </div>
          <div className="non-gps-kpi-card">
            <span className="non-gps-kpi-label">Completed</span>
            <strong className="non-gps-kpi-value">
              {formatNumber(street.counters.completed)}
            </strong>
          </div>
        </div>
      </div>

      <NonGpsBatchingSummary counters={street.counters} />
      {(searchText || Object.values(filters).some(Boolean)) && (
        <button type="button" style={styles.backButton} onClick={() => {
          setFilters({ ...EMPTY_FILTERS }); setSearchText(""); setPage(1);
        }}>Clear All Filters</button>
      )}
      {quickSelectNotice ? (
        <div role="status" style={styles.quickSelectNotice}>
          <span>{quickSelectNotice}</span>
          <button type="button" style={styles.noticeDismiss} onClick={() => setQuickSelectNotice("")}
            aria-label="Dismiss quick select message">×</button>
        </div>
      ) : null}

      <PaginationControls
        currentPage={safePage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={filteredTargets.length}
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
      />

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.headerCell}>Select</th>
              <th style={styles.headerCell}>
                <SortButton
                  label="Address"
                  sortKey="address"
                  sortConfig={sortConfig}
                  onSort={updateSort}
                />
              </th>
              <th style={styles.headerCell}>
                <SortButton
                  label="Meter Number"
                  sortKey="meterNo"
                  sortConfig={sortConfig}
                  onSort={updateSort}
                />
              </th>
              <th style={styles.headerCell}>
                <SortButton
                  label="Sales Meter Status"
                  sortKey="salesStatus"
                  sortConfig={sortConfig}
                  onSort={updateSort}
                />
              </th>
              <th style={styles.headerCell}>
                <SortButton label="Batch ID" sortKey="batchId" sortConfig={sortConfig} onSort={updateSort} />
              </th>
            </tr>
            <tr>
              <th style={styles.filterCell}>
                <NonGpsQuickSelect
                  onApply={handleQuickSelect}
                  disabled={!street.targets.some((target) => target.batchable === true)}
                />
              </th>
              <th style={styles.filterCell}>
                <ColumnFilter
                  value={filters.address}
                  onChange={(value) => updateFilter("address", value)}
                  placeholder="Filter address"
                />
              </th>
              <th style={styles.filterCell}>
                <ColumnFilter
                  value={filters.meterNo}
                  onChange={(value) => updateFilter("meterNo", value)}
                  placeholder="Filter meter number"
                />
              </th>
              <th style={styles.filterCell}>
                <SalesStatusFilter
                  value={filters.salesStatus}
                  onChange={(value) => updateFilter("salesStatus", value)}
                />
              </th>
              <th style={styles.filterCell}>
                <select value={filters.batchId} onChange={(event) => updateFilter("batchId", event.target.value)}
                  style={styles.headerInput} aria-label="Filter Batch ID">
                  <option value="">All batches</option>
                  <option value="NONE">Not Batched</option>
                  <option value="UNRESOLVED">Unresolved</option>
                  {batchOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </th>
            </tr>
          </thead>
          <tbody>
            {pagedTargets.length === 0 ? (
              <tr>
                <td colSpan={5} style={styles.emptyCell}>
                  No street targets match the current filters.
                </td>
              </tr>
            ) : (
              pagedTargets.map((target) => {
                const batchable = target.batchable === true;
                const checked = selectedIds.has(target.id);
                const meterLabel =
                  target.meterNo || target.canonicalAddress || "Sales meter";

                return (
                  <tr key={target.id}>
                    <td style={styles.bodyCell}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!batchable}
                        onChange={() => {
                          setQuickSelectNotice("");
                          onToggleTarget?.(target);
                        }}
                        aria-label={`${checked ? "Deselect" : "Select"} ${meterLabel}`}
                        title={
                          !batchable
                            ? target.batchabilityReason || "Not batchable"
                            : checked ? "Deselect batchable Sales meter" : "Select batchable Sales meter"
                        }
                      />
                    </td>
                    <td style={styles.bodyCell}>
                      {target.canonicalAddress || "NAv"}
                      {/* Rules TB-R046: only CAT meters are field work. With Show Normal on, a Normal or
                          uncategorised meter is marked here and can never be ticked. */}
                      {target.category && target.category !== "CAT" ? (
                        <span style={styles.categoryTag}>{target.category === "NORMAL" ? "Normal" : "No cat"}</span>
                      ) : null}
                      {/* A reason another column already shows gets no note: Batch ID shows
                          current batch membership, Sales Meter Status shows In Progress /
                          Completed, the tag above shows Normal / No cat. Other reasons a meter
                          cannot be ticked stay visible. */}
                      {!target.batchable && !REASONS_SHOWN_IN_COLUMNS.has(target.batchabilityCode)
                        ? <div>{target.batchabilityReason}</div> : null}
                    </td>
                    <td style={styles.bodyCell}>{target.meterNo || "NAv"}</td>
                    <td style={styles.bodyCell}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...salesStatusStyle(target.salesWorkStatus),
                        }}
                      >
                        {target.salesWorkStatus}
                      </span>
                    </td>
                    <td style={styles.bodyCell}>
                      {target.membership.state === "MEMBER" ? (
                        <button type="button" style={styles.batchLink}
                          aria-label={"View Targeted Batch " + target.membership.tbId}
                          onClick={() => setOpenBatch({ salesId: target.id, tbId: target.membership.tbId, lmPcode })}>
                          {getSalesTargetedBatchMembershipLabel(target.membership)}
                        </button>
                      ) : (
                        <span title={target.membership.reason || undefined}>
                          {getSalesTargetedBatchMembershipLabel(target.membership)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls
        currentPage={safePage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={filteredTargets.length}
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
      />
      {openBatch && openBatchIsCurrent && (
        <SalesTargetedBatchDetailsModal key={openBatch.lmPcode + openBatch.tbId}
          tbId={openBatch.tbId} lmPcode={openBatch.lmPcode} onClose={() => setOpenBatch(null)} />
      )}
    </section>
  );
}

const styles = {
  quickSelectNotice: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "0.75rem",
    margin: "0 1.1rem 0.75rem",
    padding: "0.65rem 0.8rem",
    border: "1px solid #fde68a",
    borderRadius: "0.6rem",
    background: "#fffbeb",
    color: "#92400e",
    fontSize: "0.84rem",
    fontWeight: 700,
  },
  noticeDismiss: {
    border: 0,
    padding: 0,
    background: "transparent",
    color: "#92400e",
    fontSize: "1rem",
    lineHeight: 1,
    cursor: "pointer",
  },
  batchLink: { border: 0, padding: 0, background: "none", color: "#1d4ed8",
    textDecoration: "underline", cursor: "pointer", font: "inherit", textAlign: "left" },
  panel: {
    border: "1px solid #dbe3ef",
    borderRadius: "1rem",
    background: "#ffffff",
    overflow: "hidden",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  backButton: {
    border: 0,
    padding: 0,
    marginBottom: "0.55rem",
    background: "transparent",
    color: "#475569",
    fontWeight: 800,
    cursor: "pointer",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: { margin: "0.18rem 0 0", color: "#0f172a", fontSize: "1.15rem" },
  subtitle: { margin: "0.3rem 0 0", color: "#64748b", fontSize: "0.86rem" },
  searchInput: {
    width: "min(360px, 100%)",
    border: "1px solid #cbd5e1",
    borderRadius: "0.65rem",
    padding: "0.62rem 0.72rem",
    font: "inherit",
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: "820px" },
  headerCell: {
    padding: "0.58rem 0.7rem 0.35rem",
    borderTop: "1px solid #e2e8f0",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
    color: "#475569",
    fontSize: "0.75rem",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  filterCell: {
    padding: "0 0.7rem 0.55rem",
    borderBottom: "1px solid #dbe3ef",
    background: "#f8fafc",
  },
  sortButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    border: 0,
    padding: 0,
    background: "transparent",
    color: "#475569",
    font: "inherit",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  sortButtonActive: { color: "#1d4ed8" },
  headerInput: {
    width: "100%",
    minWidth: "96px",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: "0.48rem",
    background: "#ffffff",
    padding: "0.42rem 0.5rem",
    color: "#334155",
    fontSize: "0.74rem",
    font: "inherit",
  },
  bodyCell: {
    padding: "0.72rem 0.8rem",
    borderBottom: "1px solid #edf2f7",
    color: "#334155",
    fontSize: "0.84rem",
    verticalAlign: "top",
  },
  categoryTag: { marginLeft: 8, borderRadius: 999, padding: "2px 8px", background: "#f1f5f9", border: "1px solid #cbd5e1", color: "#475569", fontSize: "0.7rem", fontWeight: 900, whiteSpace: "nowrap" },
  statusBadge: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "0.3rem 0.5rem",
    fontSize: "0.7rem",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  emptyCell: { padding: "1.25rem", textAlign: "center", color: "#64748b" },
  paginationBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    flexWrap: "wrap",
    padding: "0.75rem 0.9rem",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  paginationSummary: {
    color: "#64748b",
    fontSize: "0.78rem",
    fontWeight: 700,
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
    color: "#475569",
    fontSize: "0.78rem",
    fontWeight: 700,
  },
  pageSizeSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.5rem",
    background: "#ffffff",
    padding: "0.34rem 0.45rem",
    color: "#334155",
    font: "inherit",
  },
  paginationButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.5rem",
    background: "#ffffff",
    color: "#334155",
    padding: "0.38rem 0.58rem",
    fontSize: "0.76rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  pageCountLabel: {
    color: "#475569",
    fontSize: "0.78rem",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
};
