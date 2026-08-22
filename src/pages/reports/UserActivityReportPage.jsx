import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import DownloadButtons from "../../components/DownloadButtons";
import { generateUserActivityManagedReport } from "./userActivityReportArtifact";
import { buildActivitySummary } from "./activityAnalyticsModel";
import useActivityAnalytics from "./useActivityAnalytics";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;

const DATE_PRESETS = [
  { id: "TODAY", label: "Today" },
  { id: "YESTERDAY", label: "Yesterday" },
  { id: "THIS_WEEK", label: "This Week" },
  { id: "LAST_7_DAYS", label: "Last 7 Days" },
  { id: "THIS_MONTH", label: "This Month" },
  { id: "LAST_MONTH", label: "Last Month" },
  { id: "ALL_TIME", label: "All Time" },
  { id: "CUSTOM", label: "Custom Range" },
];

const NUMBER_COLUMNS = new Set([
  "memberCount",
  "totalTrns",
  "meterDiscoveryTrns",
  "noAccessTrns",
  "meterInspectionTrns",
  "meterInstallationTrns",
  "meterRemovalTrns",
  "meterDisconnectionTrns",
  "meterReconnectionTrns",
]);

const USER_TABLE_COLUMNS = [
  { key: "userName", label: "User", filterType: "select" },
  { key: "serviceProviderName", label: "Service Provider", filterType: "select" },
  { key: "teamName", label: "Team", filterType: "select" },
  { key: "totalTrns", label: "Total TRNs", filterType: "number" },
  { key: "meterDiscoveryTrns", label: "Meter Discovery", filterType: "number" },
  { key: "noAccessTrns", label: "No Access", filterType: "number" },
  { key: "meterInspectionTrns", label: "Inspection", filterType: "number" },
  { key: "meterInstallationTrns", label: "Installation", filterType: "number" },
  { key: "meterRemovalTrns", label: "Removal", filterType: "number" },
  { key: "meterDisconnectionTrns", label: "Disconnection", filterType: "number" },
  { key: "meterReconnectionTrns", label: "Reconnection", filterType: "number" },
  { key: "lastUpdatedAt", label: "Last Updated At", filterType: null },
];

const TEAM_TABLE_COLUMNS = [
  { key: "teamName", label: "Team", filterType: "select" },
  { key: "memberCount", label: "Members", filterType: "number" },
  { key: "serviceProviderName", label: "Service Providers", filterType: "select" },
  { key: "totalTrns", label: "Total TRNs", filterType: "number" },
  { key: "meterDiscoveryTrns", label: "Meter Discovery", filterType: "number" },
  { key: "noAccessTrns", label: "No Access", filterType: "number" },
  { key: "meterInspectionTrns", label: "Inspection", filterType: "number" },
  { key: "meterInstallationTrns", label: "Installation", filterType: "number" },
  { key: "meterRemovalTrns", label: "Removal", filterType: "number" },
  { key: "meterDisconnectionTrns", label: "Disconnection", filterType: "number" },
  { key: "meterReconnectionTrns", label: "Reconnection", filterType: "number" },
  { key: "lastUpdatedAt", label: "Last Updated At", filterType: null },
];

function createEmptyColumnFilters(columns) {
  return columns.reduce((filters, column) => {
    if (column.filterType) filters[column.key] = "";
    return filters;
  }, {});
}

const EMPTY_USER_COLUMN_FILTERS = createEmptyColumnFilters(USER_TABLE_COLUMNS);
const EMPTY_TEAM_COLUMN_FILTERS = createEmptyColumnFilters(TEAM_TABLE_COLUMNS);

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

function hasMeaningfulValue(value) {
  const text = String(value || "").trim();
  return Boolean(text && !["NAV", "NAV", "-"].includes(text.toUpperCase()));
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function formatDateTime(value) {
  if (!value || value === "NAv") return "NAv";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NAv";
  return date.toLocaleString();
}

function toDateTimeLocalValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}



function matchesNumericFilter(value, filterValue) {
  const expression = String(filterValue || "").trim();
  if (!expression) return true;

  const match = expression.match(/^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return true;

  const operator = match[1] || "=";
  const expected = Number(match[2]);
  const actual = Number(value);

  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;

  if (operator === ">=") return actual >= expected;
  if (operator === "<=") return actual <= expected;
  if (operator === ">") return actual > expected;
  if (operator === "<") return actual < expected;
  return actual === expected;
}

function sortValue(row, key) {
  if (NUMBER_COLUMNS.has(key)) return Number(row?.[key] || 0);
  if (key === "lastUpdatedAt") {
    const date = new Date(row?.lastUpdatedAt || 0);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  return String(row?.[key] || "").toLowerCase();
}

function sortRows(rows, sortKey, sortDirection) {
  if (!sortKey || !sortDirection) return rows;

  return [...rows].sort((left, right) => {
    const leftValue = sortValue(left, sortKey);
    const rightValue = sortValue(right, sortKey);

    let comparison = 0;
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      comparison = leftValue - rightValue;
    } else {
      comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    if (comparison === 0) {
      comparison = String(left?.userName || left?.teamName || "").localeCompare(
        String(right?.userName || right?.teamName || ""),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });
}

function SortButton({
  label,
  sortKey,
  activeSortKey,
  sortDirection,
  onSort,
}) {
  const isActive = activeSortKey === sortKey;
  const directionLabel = isActive
    ? sortDirection === "asc"
      ? "↑"
      : sortDirection === "desc"
        ? "↓"
        : "↕"
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

function FilterInput({ value, onChange, placeholder, ariaLabel }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      style={styles.headerInput}
    />
  );
}

function FilterSelect({ value, onChange, options, ariaLabel }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      style={styles.headerInput}
    >
      <option value="">All</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
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

const dateFilterStyles = {
  filterButton: {
    width: "100%",
    minWidth: "16rem",
    marginTop: "0.4rem",
    border: "1px solid #2563eb",
    borderRadius: "0.45rem",
    padding: "0.38rem 0.45rem",
    fontSize: "0.72rem",
    fontWeight: 800,
    color: "#1d4ed8",
    background: "#eff6ff",
    cursor: "pointer",
    textAlign: "left",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 10000,
    minHeight: "100vh",
    width: "100vw",
    background: "rgba(15, 23, 42, 0.48)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  card: {
    width: "min(94vw, 38rem)",
    maxHeight: "90vh",
    overflowY: "auto",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 25px 80px rgba(15, 23, 42, 0.32)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#2563eb",
  },
  title: {
    margin: "0.2rem 0 0",
    fontSize: "1.1rem",
    color: "#0f172a",
  },
  subtitle: {
    margin: "0.25rem 0 0",
    color: "#64748b",
    fontSize: "0.88rem",
  },
  closeButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    borderRadius: "999px",
    width: "2rem",
    height: "2rem",
    cursor: "pointer",
    fontWeight: 900,
  },
  body: {
    padding: "1rem 1.1rem",
  },
  presetGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
    gap: "0.6rem",
  },
  presetButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.75rem",
    background: "#f8fafc",
    color: "#0f172a",
    padding: "0.7rem",
    fontWeight: 800,
    cursor: "pointer",
    textAlign: "left",
  },
  presetButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  customBox: {
    marginTop: "1rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.85rem",
    padding: "0.9rem",
    background: "#ffffff",
  },
  customGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
    gap: "0.75rem",
    marginTop: "0.75rem",
  },
  dateLabel: {
    display: "grid",
    gap: "0.35rem",
    color: "#334155",
    fontWeight: 800,
    fontSize: "0.82rem",
  },
  dateInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.6rem",
    padding: "0.55rem",
    fontSize: "0.9rem",
    background: "#ffffff",
  },
  errorText: {
    margin: "0.75rem 0 0",
    color: "#dc2626",
    fontSize: "0.82rem",
    fontWeight: 800,
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.6rem",
    padding: "0.9rem 1.1rem",
    borderTop: "1px solid #e2e8f0",
  },
  cancelButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.8rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  applyButton: {
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.8rem",
    fontWeight: 900,
    cursor: "pointer",
  },
};

export default function UserActivityReportPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const [tableView, setTableView] = useState("USERS");
  const [userColumnFilters, setUserColumnFilters] = useState(EMPTY_USER_COLUMN_FILTERS);
  const [userSortKey, setUserSortKey] = useState("lastUpdatedAt");
  const [userSortDirection, setUserSortDirection] = useState("desc");
  const [userCurrentPage, setUserCurrentPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [teamColumnFilters, setTeamColumnFilters] = useState(EMPTY_TEAM_COLUMN_FILTERS);
  const [teamSortKey, setTeamSortKey] = useState("lastUpdatedAt");
  const [teamSortDirection, setTeamSortDirection] = useState("desc");
  const [teamCurrentPage, setTeamCurrentPage] = useState(1);
  const [teamPageSize, setTeamPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [activeDateFilter, setActiveDateFilter] = useState({
    preset: "ALL_TIME",
    customStart: "",
    customEnd: "",
  });
  const [draftDateFilter, setDraftDateFilter] = useState(activeDateFilter);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [dateFilterError, setDateFilterError] = useState("");

  const {
    userRows,
    teamRows,
    dateRange,
    integrity,
    isLoading,
    isFetching,
    error,
  } = useActivityAnalytics({
    lmPcode: activeLmPcode,
    dateFilter: activeDateFilter,
  });

  const userDropdownFilterOptions = useMemo(() => {
    const userNames = new Set();
    const serviceProviderNames = new Set();
    const teamNames = new Set();

    userRows.forEach((row) => {
      if (hasMeaningfulValue(row.userName)) userNames.add(row.userName);
      (row.serviceProviderNames || []).forEach((name) => {
        if (hasMeaningfulValue(name)) serviceProviderNames.add(name);
      });
      (row.teamNames || []).forEach((name) => {
        if (hasMeaningfulValue(name)) teamNames.add(name);
      });
    });

    return {
      userName: Array.from(userNames).sort((left, right) => left.localeCompare(right)),
      serviceProviderName: Array.from(serviceProviderNames).sort((left, right) =>
        left.localeCompare(right),
      ),
      teamName: Array.from(teamNames).sort((left, right) => left.localeCompare(right)),
    };
  }, [userRows]);

  const teamDropdownFilterOptions = useMemo(() => {
    const teamNames = new Set();
    const serviceProviderNames = new Set();

    teamRows.forEach((row) => {
      if (hasMeaningfulValue(row.teamName)) teamNames.add(row.teamName);
      (row.serviceProviderNames || []).forEach((name) => {
        if (hasMeaningfulValue(name)) serviceProviderNames.add(name);
      });
    });

    return {
      teamName: Array.from(teamNames).sort((left, right) => left.localeCompare(right)),
      serviceProviderName: Array.from(serviceProviderNames).sort((left, right) =>
        left.localeCompare(right),
      ),
    };
  }, [teamRows]);

  const filteredUserRows = useMemo(
    () =>
      userRows.filter((row) =>
        USER_TABLE_COLUMNS.every((column) => {
          if (!column.filterType) return true;
          const filterValue = userColumnFilters[column.key];
          if (!filterValue) return true;

          if (column.filterType === "number") {
            return matchesNumericFilter(row[column.key], filterValue);
          }

          if (column.key === "serviceProviderName") {
            return (row.serviceProviderNames || []).includes(filterValue);
          }

          if (column.key === "teamName") {
            return (row.teamNames || []).includes(filterValue);
          }

          return row[column.key] === filterValue;
        }),
      ),
    [userRows, userColumnFilters],
  );

  const filteredTeamRows = useMemo(
    () =>
      teamRows.filter((row) =>
        TEAM_TABLE_COLUMNS.every((column) => {
          if (!column.filterType) return true;
          const filterValue = teamColumnFilters[column.key];
          if (!filterValue) return true;

          if (column.filterType === "number") {
            return matchesNumericFilter(row[column.key], filterValue);
          }

          if (column.key === "serviceProviderName") {
            return (row.serviceProviderNames || []).includes(filterValue);
          }

          return row[column.key] === filterValue;
        }),
      ),
    [teamRows, teamColumnFilters],
  );

  const sortedUserRows = useMemo(
    () => sortRows(filteredUserRows, userSortKey, userSortDirection),
    [filteredUserRows, userSortKey, userSortDirection],
  );
  const sortedTeamRows = useMemo(
    () => sortRows(filteredTeamRows, teamSortKey, teamSortDirection),
    [filteredTeamRows, teamSortKey, teamSortDirection],
  );

  const userTotalPages = Math.max(1, Math.ceil(sortedUserRows.length / userPageSize));
  const safeUserCurrentPage = Math.max(1, Math.min(userCurrentPage, userTotalPages));
  const userPageStart = sortedUserRows.length === 0 ? 0 : (safeUserCurrentPage - 1) * userPageSize;
  const paginatedUserRows = useMemo(
    () => sortedUserRows.slice(userPageStart, userPageStart + userPageSize),
    [sortedUserRows, userPageStart, userPageSize],
  );

  const teamTotalPages = Math.max(1, Math.ceil(sortedTeamRows.length / teamPageSize));
  const safeTeamCurrentPage = Math.max(1, Math.min(teamCurrentPage, teamTotalPages));
  const teamPageStart = sortedTeamRows.length === 0 ? 0 : (safeTeamCurrentPage - 1) * teamPageSize;
  const paginatedTeamRows = useMemo(
    () => sortedTeamRows.slice(teamPageStart, teamPageStart + teamPageSize),
    [sortedTeamRows, teamPageStart, teamPageSize],
  );

  const totals = useMemo(() => buildActivitySummary(filteredUserRows), [filteredUserRows]);
  const topUser = useMemo(
    () =>
      filteredUserRows.reduce((top, row) => {
        if (!top || row.totalTrns > top.totalTrns) return row;
        return top;
      }, null),
    [filteredUserRows],
  );
  const visibleServiceProviderCount = useMemo(
    () =>
      new Set(
        filteredUserRows
          .flatMap((row) => row.serviceProviderNames || [])
          .filter(hasMeaningfulValue),
      ).size,
    [filteredUserRows],
  );
  const visibleTeamCount = useMemo(
    () =>
      new Set(
        filteredUserRows.flatMap((row) => row.teamNames || []).filter(hasMeaningfulValue),
      ).size,
    [filteredUserRows],
  );

  const userDownloadColumns = useMemo(
    () => [
      { header: "User", value: (row) => row.userName || "NAv" },
      { header: "Service Provider", value: (row) => row.serviceProviderName || "NAv" },
      { header: "Team", value: (row) => row.teamName || "NAv" },
      { header: "Total TRNs", value: (row) => row.totalTrns || 0 },
      { header: "Meter Discovery", value: (row) => row.meterDiscoveryTrns || 0 },
      { header: "No Access", value: (row) => row.noAccessTrns || 0 },
      { header: "Inspection", value: (row) => row.meterInspectionTrns || 0 },
      { header: "Installation", value: (row) => row.meterInstallationTrns || 0 },
      { header: "Removal", value: (row) => row.meterRemovalTrns || 0 },
      { header: "Disconnection", value: (row) => row.meterDisconnectionTrns || 0 },
      { header: "Reconnection", value: (row) => row.meterReconnectionTrns || 0 },
      { header: "Last Updated At", value: (row) => formatDateTime(row.lastUpdatedAt) },
    ],
    [],
  );

  const teamDownloadColumns = useMemo(
    () => [
      { header: "Team", value: (row) => row.teamName || "NAv" },
      { header: "Members", value: (row) => row.memberCount || 0 },
      { header: "Service Providers", value: (row) => row.serviceProviderName || "NAv" },
      { header: "Total TRNs", value: (row) => row.totalTrns || 0 },
      { header: "Meter Discovery", value: (row) => row.meterDiscoveryTrns || 0 },
      { header: "No Access", value: (row) => row.noAccessTrns || 0 },
      { header: "Inspection", value: (row) => row.meterInspectionTrns || 0 },
      { header: "Installation", value: (row) => row.meterInstallationTrns || 0 },
      { header: "Removal", value: (row) => row.meterRemovalTrns || 0 },
      { header: "Disconnection", value: (row) => row.meterDisconnectionTrns || 0 },
      { header: "Reconnection", value: (row) => row.meterReconnectionTrns || 0 },
      { header: "Last Updated At", value: (row) => formatDateTime(row.lastUpdatedAt) },
    ],
    [],
  );

  const quickDownloadScope = useMemo(
    () => ({
      lmName: activeWorkbaseName,
      lmPcode: activeLmPcode || "NAv",
      wardLabel: dateRange?.label || "All Time",
      wardPcode: "NAv",
    }),
    [activeWorkbaseName, activeLmPcode, dateRange?.label],
  );

  const isTeamsView = tableView === "TEAMS";
  const activeColumns = isTeamsView ? TEAM_TABLE_COLUMNS : USER_TABLE_COLUMNS;
  const activeColumnFilters = isTeamsView ? teamColumnFilters : userColumnFilters;
  const activeSortKey = isTeamsView ? teamSortKey : userSortKey;
  const activeSortDirection = isTeamsView ? teamSortDirection : userSortDirection;
  const activeSortedRows = isTeamsView ? sortedTeamRows : sortedUserRows;
  const activePaginatedRows = isTeamsView ? paginatedTeamRows : paginatedUserRows;
  const activePageSize = isTeamsView ? teamPageSize : userPageSize;
  const activeCurrentPage = isTeamsView ? safeTeamCurrentPage : safeUserCurrentPage;
  const activeTotalPages = isTeamsView ? teamTotalPages : userTotalPages;
  const activeDropdownOptions = isTeamsView
    ? teamDropdownFilterOptions
    : userDropdownFilterOptions;
  const activeDownloadColumns = isTeamsView ? teamDownloadColumns : userDownloadColumns;
  const activeRowsLabel = isTeamsView ? "teams" : "users";

  const managedReportSourceScope = useMemo(() => {
    const appliedColumnFilters = Object.entries(activeColumnFilters).reduce(
      (filters, [key, value]) => {
        if (value !== "") filters[key] = value;
        return filters;
      },
      {},
    );

    return {
      view: "FILTERED_SORTED_ROWS",
      tableView,
      lmPcode: activeLmPcode || null,
      lmName: activeWorkbaseName || null,
      datePreset: activeDateFilter.preset,
      dateRange: dateRange?.label || "All Time",
      columnFilters: appliedColumnFilters,
      sort: {
        key: activeSortKey,
        direction: activeSortDirection,
      },
    };
  }, [
    activeColumnFilters,
    activeDateFilter.preset,
    activeLmPcode,
    activeSortDirection,
    activeSortKey,
    activeWorkbaseName,
    dateRange?.label,
    tableView,
  ]);

  const integrityIssueCount =
    integrity.unclassifiedTrns + integrity.missingCreatedByUid + integrity.missingCreatedAt;

  function handleSort(columnKey) {
    const sortKey = isTeamsView ? teamSortKey : userSortKey;
    const sortDirection = isTeamsView ? teamSortDirection : userSortDirection;
    const setSortKey = isTeamsView ? setTeamSortKey : setUserSortKey;
    const setSortDirection = isTeamsView ? setTeamSortDirection : setUserSortDirection;
    const setCurrentPage = isTeamsView ? setTeamCurrentPage : setUserCurrentPage;

    setCurrentPage(1);
    if (sortKey !== columnKey) {
      setSortKey(columnKey);
      setSortDirection("asc");
      return;
    }

    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }

    if (sortDirection === "desc") {
      setSortKey("lastUpdatedAt");
      setSortDirection("desc");
      return;
    }

    setSortKey(columnKey);
    setSortDirection("asc");
  }

  function handleColumnFilterChange(columnKey, value) {
    if (isTeamsView) {
      setTeamCurrentPage(1);
      setTeamColumnFilters((current) => ({ ...current, [columnKey]: value }));
      return;
    }

    setUserCurrentPage(1);
    setUserColumnFilters((current) => ({ ...current, [columnKey]: value }));
  }

  function handleClearFilters() {
    setActiveDateFilter({ preset: "ALL_TIME", customStart: "", customEnd: "" });

    if (isTeamsView) {
      setTeamCurrentPage(1);
      setTeamColumnFilters({ ...EMPTY_TEAM_COLUMN_FILTERS });
      setTeamSortKey("lastUpdatedAt");
      setTeamSortDirection("desc");
      return;
    }

    setUserCurrentPage(1);
    setUserColumnFilters({ ...EMPTY_USER_COLUMN_FILTERS });
    setUserSortKey("lastUpdatedAt");
    setUserSortDirection("desc");
  }

  function handlePageChange(nextPage) {
    const totalPages = isTeamsView ? teamTotalPages : userTotalPages;
    const setCurrentPage = isTeamsView ? setTeamCurrentPage : setUserCurrentPage;
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

    if (isTeamsView) {
      setTeamPageSize(nextSize);
      setTeamCurrentPage(1);
      return;
    }

    setUserPageSize(nextSize);
    setUserCurrentPage(1);
  }

  function openDateModal() {
    setDraftDateFilter({ ...activeDateFilter });
    setDateFilterError("");
    setIsDateModalOpen(true);
  }

  function chooseDatePreset(preset) {
    if (preset !== "CUSTOM") {
      setDraftDateFilter({ preset, customStart: "", customEnd: "" });
      setDateFilterError("");
      return;
    }

    const now = new Date();
    setDraftDateFilter((current) => ({
      preset: "CUSTOM",
      customStart: current.customStart || toDateTimeLocalValue(startOfDay(now)),
      customEnd: current.customEnd || toDateTimeLocalValue(now),
    }));
    setDateFilterError("");
  }

  function applyDateFilter() {
    if (draftDateFilter.preset === "CUSTOM") {
      const start = draftDateFilter.customStart ? new Date(draftDateFilter.customStart) : null;
      const end = draftDateFilter.customEnd ? new Date(draftDateFilter.customEnd) : null;

      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        setDateFilterError("Choose both the From and To date/time values.");
        return;
      }

      if (start > end) {
        setDateFilterError("The From date/time must be before the To date/time.");
        return;
      }
    }

    setUserCurrentPage(1);
    setTeamCurrentPage(1);
    setActiveDateFilter({ ...draftDateFilter });
    setDateFilterError("");
    setIsDateModalOpen(false);
  }

  async function handleUserActivityFullDownload() {
    return generateUserActivityManagedReport({
      rows: activeSortedRows,
      columns: activeDownloadColumns,
      scope: quickDownloadScope,
      sourceScope: managedReportSourceScope,
    });
  }

  function renderCell(row, column) {
    if (column.key === "lastUpdatedAt") return formatDateTime(row.lastUpdatedAt);
    if (NUMBER_COLUMNS.has(column.key)) return formatNumber(row[column.key]);
    return row[column.key] || "NAv";
  }

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Report</p>
          <h1>User Activity Report</h1>

          <p className="muted">
            Live TRN activity for {activeWorkbaseName}, attributed by TRN creation metadata.
          </p>

          <Link className="text-link" to="/reports">
            ← Back to Reports
          </Link>
        </div>

        <div className="topbar-right">
          <div className="role-pill">
            {isFetching
              ? "Streaming..."
              : `${formatNumber(filteredUserRows.length)} users • ${formatNumber(
                  totals.totalTrns,
                )} TRNs`}
          </div>

          <DownloadButtons
            registryName="User Activity Report"
            rowsLabel={activeRowsLabel}
            visibleRows={activeSortedRows}
            columns={activeDownloadColumns}
            fileBaseName="user_activity_report"
            scope={quickDownloadScope}
            onFullDownload={handleUserActivityFullDownload}
          />
        </div>
      </header>

      <section className="filter-panel">
        <label>
          Created At
          <button
            type="button"
            style={dateFilterStyles.filterButton}
            onClick={openDateModal}
            title="Filter metadata.createdAt"
          >
            {dateRange?.label || "All Time"}
          </button>
        </label>

        <div>
          <strong>Column filters</strong>
          <div className="muted">Use the filters directly under each table heading.</div>
        </div>

        <div className="filter-actions">
          <button type="button" className="ghost-button" onClick={handleClearFilters}>
            Clear Filters
          </button>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Users</span>
          <strong>{formatNumber(filteredUserRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Total TRNs</span>
          <strong>{formatNumber(totals.totalTrns)}</strong>
        </div>

        <div className="stat-card">
          <span>Meter Discovery</span>
          <strong>{formatNumber(totals.meterDiscoveryTrns)}</strong>
        </div>

        <div className="stat-card">
          <span>No Access</span>
          <strong>{formatNumber(totals.noAccessTrns)}</strong>
        </div>

        <div className="stat-card">
          <span>Top User</span>
          <strong>{topUser?.userName || "NAv"}</strong>
        </div>

        <div className="stat-card">
          <span>Service Providers</span>
          <strong>{formatNumber(visibleServiceProviderCount)}</strong>
        </div>

        <div className="stat-card">
          <span>Teams</span>
          <strong>{formatNumber(visibleTeamCount)}</strong>
        </div>

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
        </div>
      </section>

      <section className="table-panel">
        <div className="activity-table-view-bar" aria-label="User Activity table view">
          <span>Table View</span>
          <div className="activity-table-view-toggle" role="group" aria-label="Select table view">
            <button
              type="button"
              className={tableView === "USERS" ? "active" : ""}
              aria-pressed={tableView === "USERS"}
              onClick={() => setTableView("USERS")}
            >
              Users
            </button>
            <button
              type="button"
              className={tableView === "TEAMS" ? "active" : ""}
              aria-pressed={tableView === "TEAMS"}
              onClick={() => setTableView("TEAMS")}
            >
              Teams
            </button>
          </div>
        </div>

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load User Activity</h2>
            <p className="muted">
              One of the live TRN, user, team, or service-provider streams could not be opened.
            </p>
          </div>
        ) : null}

        {integrityIssueCount > 0 ? (
          <div className="empty-state error-box">
            <h2>Reporting integrity warning</h2>
            <p className="muted">
              {integrity.unclassifiedTrns > 0
                ? `${formatNumber(
                    integrity.unclassifiedTrns,
                  )} TRNs are outside the seven recognised reporting buckets. `
                : ""}
              {integrity.missingCreatedByUid > 0
                ? `${formatNumber(
                    integrity.missingCreatedByUid,
                  )} classified TRNs have no metadata.createdByUid. `
                : ""}
              {integrity.missingCreatedAt > 0
                ? `${formatNumber(
                    integrity.missingCreatedAt,
                  )} source TRNs have no usable metadata.createdAt.`
                : ""}
            </p>

            {integrity.unclassifiedTypes.length > 0 ? (
              <p className="muted">
                Unclassified types: {integrity.unclassifiedTypes
                  .map(([type, count]) => `${type} (${formatNumber(count)})`)
                  .join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading User Activity...</h2>
            <p className="muted">Opening live TRN, user, team and service-provider streams.</p>
          </div>
        ) : null}

        {!isLoading && activeSortedRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No {isTeamsView ? "Team Activity" : "User Activity"} rows found</h2>
            <p className="muted">
              No matching rows were found for the current LM, Created At, and column filters.
            </p>
          </div>
        ) : null}

        {activeSortedRows.length > 0 ? (
          <>
            <PaginationControls
              currentPage={activeCurrentPage}
              pageSize={activePageSize}
              totalPages={activeTotalPages}
              totalRows={activeSortedRows.length}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {activeColumns.map((column) => (
                      <th key={column.key}>
                        <SortButton
                          label={column.label}
                          sortKey={column.key}
                          activeSortKey={activeSortKey}
                          sortDirection={activeSortDirection}
                          onSort={handleSort}
                        />

                        {column.filterType === "select" ? (
                          <FilterSelect
                            value={activeColumnFilters[column.key] || ""}
                            onChange={(value) => handleColumnFilterChange(column.key, value)}
                            options={activeDropdownOptions[column.key] || []}
                            ariaLabel={`Filter ${column.label}`}
                          />
                        ) : column.filterType ? (
                          <FilterInput
                            value={activeColumnFilters[column.key] || ""}
                            onChange={(value) => handleColumnFilterChange(column.key, value)}
                            placeholder=""
                            ariaLabel={`Filter ${column.label}`}
                          />
                        ) : (
                          <div style={styles.headerFilterSpacer} aria-hidden="true" />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {activePaginatedRows.map((row) => (
                    <tr key={row.id}>
                      {activeColumns.map((column) => (
                        <td
                          key={column.key}
                          style={column.key === "totalTrns" ? styles.totalTrnsValue : undefined}
                        >
                          {renderCell(row, column)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={activeCurrentPage}
              pageSize={activePageSize}
              totalPages={activeTotalPages}
              totalRows={activeSortedRows.length}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        ) : null}
      </section>

      {isDateModalOpen ? (
        <div
          role="presentation"
          style={dateFilterStyles.overlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsDateModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="date-filter-title"
            style={dateFilterStyles.card}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={dateFilterStyles.header}>
              <div>
                <p style={dateFilterStyles.eyebrow}>User Activity</p>
                <h2 id="date-filter-title" style={dateFilterStyles.title}>
                  Created At Filter
                </h2>
                <p style={dateFilterStyles.subtitle}>
                  Filter TRNs by metadata.createdAt before user aggregation.
                </p>
              </div>

              <button
                type="button"
                style={dateFilterStyles.closeButton}
                onClick={() => setIsDateModalOpen(false)}
                aria-label="Close Created At Filter"
              >
                ✕
              </button>
            </div>

            <div style={dateFilterStyles.body}>
              <div style={dateFilterStyles.presetGrid}>
                {DATE_PRESETS.map((preset) => {
                  const isActive = draftDateFilter.preset === preset.id;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => chooseDatePreset(preset.id)}
                      style={{
                        ...dateFilterStyles.presetButton,
                        ...(isActive ? dateFilterStyles.presetButtonActive : {}),
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {draftDateFilter.preset === "CUSTOM" ? (
                <div style={dateFilterStyles.customBox}>
                  <strong>Custom date &amp; time range</strong>

                  <div style={dateFilterStyles.customGrid}>
                    <label style={dateFilterStyles.dateLabel}>
                      From
                      <input
                        type="datetime-local"
                        value={draftDateFilter.customStart}
                        onChange={(event) =>
                          setDraftDateFilter((current) => ({
                            ...current,
                            customStart: event.target.value,
                          }))
                        }
                        style={dateFilterStyles.dateInput}
                      />
                    </label>

                    <label style={dateFilterStyles.dateLabel}>
                      To
                      <input
                        type="datetime-local"
                        value={draftDateFilter.customEnd}
                        onChange={(event) =>
                          setDraftDateFilter((current) => ({
                            ...current,
                            customEnd: event.target.value,
                          }))
                        }
                        style={dateFilterStyles.dateInput}
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              {dateFilterError ? (
                <p style={dateFilterStyles.errorText}>{dateFilterError}</p>
              ) : null}
            </div>

            <div style={dateFilterStyles.footer}>
              <button
                type="button"
                style={dateFilterStyles.cancelButton}
                onClick={() => setIsDateModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={dateFilterStyles.applyButton}
                onClick={applyDateFilter}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const styles = {
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
  },
  headerFilterSpacer: {
    height: "2.15rem",
    marginTop: "0.4rem",
  },
  totalTrnsValue: {
    color: "#2563eb",
    fontWeight: 800,
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
