import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import {
  useGetRegistryErfsPageByWardQuery,
  useLazyGetRegistryErfsPageByWardQuery,
  useLazySearchRegistryErfsByLmQuery,
} from "../../redux/registryErfsApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import {
  DatetimeFilterButton,
  DatetimeFilterModal,
} from "../../components/DatetimeFilter";
import DownloadButtons from "../../components/DownloadButtons";

const ERF_PAGE_SIZE = 200;
const ERF_SEARCH_LIMIT = 50;
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;
const EMPTY_ROWS = [];

const EMPTY_ERF_BROWSE_FILTERS = {
  erfNo: "",
  erfType: "ALL",
  premiseCount: "",
  electricityMeterCount: "",
  waterMeterCount: "",
  meterCount: "",
  trnsAccessCount: "",
  trnsNaCount: "",
  trnsTotalCount: "",
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

function formatUpdatedAt(value) {
  if (!value || value === "NAv") return "NAv";

  if (typeof value === "string") {
    return value.slice(0, 19).replace("T", " ");
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  return "NAv";
}

function getUpdatedAtMs(value) {
  if (!value || value === "NAv") return 0;

  if (typeof value?.toDate === "function") {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function getWardLabel(ward) {
  if (!ward) return "NAv";
  return `Ward ${ward.wardNumber}`;
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

function getCountText(value) {
  return String(Number(value) || 0);
}

function getWardNumberFromPcode(wardPcode = "") {
  const match = String(wardPcode || "").match(/(\d{1,3})$/);
  const numberValue = Number(match?.[1] || 0);

  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getSelectedWardPcodeFromGeo(geoState) {
  const selectedWard = geoState?.selectedWard || null;

  return selectedWard?.id || selectedWard?.pcode || selectedWard?.wardPcode || "";
}

function buildRegistryWardSelection(ward, fallbackWardPcode = "") {
  const wardPcode = ward?.wardPcode || ward?.pcode || ward?.id || fallbackWardPcode || "";

  if (!wardPcode) return null;

  const wardNumber = ward?.wardNumber || ward?.code || getWardNumberFromPcode(wardPcode) || "NAv";

  return {
    ...(ward || {}),
    id: wardPcode,
    pcode: wardPcode,
    wardPcode,
    code: wardNumber,
    wardNumber,
    name: ward?.wardName || ward?.name || `Ward ${wardNumber}`,
  };
}

function compareNatural(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;

  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getSortValue(row, key) {
  if (key === "erfNo") return row.erfNo || "";
  if (key === "erfType") return row.erfType || "";
  if (key === "premiseCount") return row.premiseCount || 0;
  if (key === "electricityMeterCount") return row.electricityMeterCount || 0;
  if (key === "waterMeterCount") return row.waterMeterCount || 0;
  if (key === "meterCount") return row.meterCount || 0;
  if (key === "trnsAccessCount") return row.trnsAccessCount || 0;
  if (key === "trnsNaCount") return row.trnsNaCount || 0;
  if (key === "trnsTotalCount") return row.trnsTotalCount || 0;
  if (key === "updatedAt") return getUpdatedAtMs(row.updatedAt);

  return "";
}

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;
  const directionLabel = isActive ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕";

  return (
    <button type="button" style={styles.sortButton} onClick={() => onSort(sortKey)}>
      <span>{label}</span>
      <span>{directionLabel}</span>
    </button>
  );
}

function FilterInput({ value, onChange, placeholder }) {
  return (
    <input
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

const EMPTY_UPDATED_AT_FILTER = {
  mode: "ALL",
  startDate: "",
  endDate: "",
};

function buildUpdatedAtFilter(mode) {
  return {
    mode,
    startDate: "",
    endDate: "",
  };
}

function getUpdatedAtDate(value) {
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
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0);
}

function parseDateOnly(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);

  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getUpdatedAtFilterRange(filter = EMPTY_UPDATED_AT_FILTER) {
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
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
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

function matchesUpdatedAtFilter(value, filter = EMPTY_UPDATED_AT_FILTER) {
  if (!filter || filter.mode === "ALL") return true;

  const rowDate = getUpdatedAtDate(value);
  if (!rowDate) return false;

  const { start, end } = getUpdatedAtFilterRange(filter);

  if (start && rowDate < start) return false;
  if (end && rowDate > end) return false;

  return true;
}

export default function ErfsRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);
  const [browseFilters, setBrowseFilters] = useState(EMPTY_ERF_BROWSE_FILTERS);
  const [updatedAtFilter, setUpdatedAtFilter] = useState(EMPTY_UPDATED_AT_FILTER);
  const [isUpdatedAtFilterOpen, setIsUpdatedAtFilterOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: "updatedAt", direction: "desc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [extraBrowseRows, setExtraBrowseRows] = useState([]);
  const [extraBrowseWardPcode, setExtraBrowseWardPcode] = useState("");
  const [nextCursorId, setNextCursorId] = useState(null);
  const [hasMoreOverride, setHasMoreOverride] = useState(null);
  const [browseError, setBrowseError] = useState("");

  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchType, setSearchType] = useState("");
  const [searchRows, setSearchRows] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [lastSearchLabel, setLastSearchLabel] = useState("");
  const [wasSearchLimited, setWasSearchLimited] = useState(false);

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const { data: wardRows = [], isLoading: wardsLoading } =
    useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);

  const selectedWard = useMemo(() => {
    const registryWard = wardRows.find((ward) => ward.wardPcode === selectedWardPcode) || null;
    return buildRegistryWardSelection(registryWard, selectedWardPcode);
  }, [wardRows, selectedWardPcode]);

  const effectiveSelectedWardPcode = selectedWard?.wardPcode || "";

  const firstPageQueryArg = effectiveSelectedWardPcode
    ? { wardPcode: effectiveSelectedWardPcode, cursorId: null, pageSize: ERF_PAGE_SIZE }
    : skipToken;

  const {
    data: firstPageData,
    isFetching: isFirstPageFetching,
    error: firstPageError,
  } = useGetRegistryErfsPageByWardQuery(firstPageQueryArg);

  const [loadErfsPage, { isFetching: isLoadMoreFetching }] =
    useLazyGetRegistryErfsPageByWardQuery();

  const [searchErfsByLm, { isFetching: isSearchFetching }] =
    useLazySearchRegistryErfsByLmQuery();

  const wardLookup = useMemo(() => {
    const lookup = new Map();
    wardRows.forEach((ward) => lookup.set(ward.wardPcode, ward));
    return lookup;
  }, [wardRows]);

  const firstPageRows = firstPageData?.rows || EMPTY_ROWS;
  const activeExtraBrowseRows = useMemo(() => {
    return extraBrowseWardPcode === effectiveSelectedWardPcode
      ? extraBrowseRows
      : EMPTY_ROWS;
  }, [effectiveSelectedWardPcode, extraBrowseRows, extraBrowseWardPcode]);

  const browseRows = useMemo(() => {
    return [...firstPageRows, ...activeExtraBrowseRows];
  }, [firstPageRows, activeExtraBrowseRows]);

  const filteredBrowseRows = useMemo(() => {
    return browseRows.filter((row) => {
      const erfType = String(row.erfType || "NAv").toUpperCase();

      return (
        includesText(row.erfNo, browseFilters.erfNo) &&
        (browseFilters.erfType === "ALL" || erfType === browseFilters.erfType) &&
        includesText(getCountText(row.premiseCount), browseFilters.premiseCount) &&
        includesText(getCountText(row.electricityMeterCount), browseFilters.electricityMeterCount) &&
        includesText(getCountText(row.waterMeterCount), browseFilters.waterMeterCount) &&
        includesText(getCountText(row.meterCount), browseFilters.meterCount) &&
        includesText(getCountText(row.trnsAccessCount), browseFilters.trnsAccessCount) &&
        includesText(getCountText(row.trnsNaCount), browseFilters.trnsNaCount) &&
        includesText(getCountText(row.trnsTotalCount), browseFilters.trnsTotalCount) &&
        matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter)
      );
    });
  }, [browseRows, browseFilters, updatedAtFilter]);

  const sortedBrowseRows = useMemo(() => {
    const rows = [...filteredBrowseRows];

    rows.sort((a, b) => {
      const comparison = compareNatural(getSortValue(a, sortConfig.key), getSortValue(b, sortConfig.key));
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [filteredBrowseRows, sortConfig]);

  const totalRows = sortedBrowseRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = totalRows === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalRows);
  const paginatedBrowseRows = useMemo(() => {
    return sortedBrowseRows.slice(pageStartIndex, pageEndIndex);
  }, [sortedBrowseRows, pageStartIndex, pageEndIndex]);

  const hasActiveBrowseFilters = Object.values(browseFilters).some((value) => value && value !== "ALL") || updatedAtFilter.mode !== "ALL";

  const activeNextCursorId =
    extraBrowseWardPcode === effectiveSelectedWardPcode && nextCursorId
      ? nextCursorId
      : firstPageData?.nextCursorId || null;

  const activeHasMore =
    extraBrowseWardPcode === effectiveSelectedWardPcode && hasMoreOverride !== null
      ? hasMoreOverride
      : Boolean(firstPageData?.hasMore);

  const isBrowseFetching = isFirstPageFetching || isLoadMoreFetching;

  function updateBrowseFilter(key, value) {
    setCurrentPage(1);
    setBrowseFilters((currentFilters) => ({ ...currentFilters, [key]: value }));
  }

  function handleSort(sortKey) {
    setCurrentPage(1);
    setSortConfig((current) => {
      if (current.key !== sortKey) return { key: sortKey, direction: "asc" };
      if (current.direction === "asc") return { key: sortKey, direction: "desc" };
      return { key: "updatedAt", direction: "desc" };
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

  function resetBrowseControls(nextWardPcode) {
    setBrowseFilters(EMPTY_ERF_BROWSE_FILTERS);
    setUpdatedAtFilter(EMPTY_UPDATED_AT_FILTER);
    setSortConfig({ key: "updatedAt", direction: "desc" });
    setCurrentPage(1);
    setExtraBrowseRows([]);
    setExtraBrowseWardPcode(nextWardPcode || "");
    setNextCursorId(null);
    setHasMoreOverride(null);
    setBrowseError("");
  }

  function handleBrowseWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard = wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    resetBrowseControls(nextWardPcode);

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

  async function handleLoadMore() {
    if (!effectiveSelectedWardPcode || !activeHasMore || isBrowseFetching) return;

    try {
      const result = await loadErfsPage({
        wardPcode: effectiveSelectedWardPcode,
        cursorId: activeNextCursorId,
        pageSize: ERF_PAGE_SIZE,
      }).unwrap();

      setExtraBrowseRows((currentRows) => {
        const existingIds = new Set([
          ...firstPageRows.map((row) => row.id),
          ...currentRows.map((row) => row.id),
        ]);

        const newRows = (result.rows || []).filter((row) => !existingIds.has(row.id));
        return [...currentRows, ...newRows];
      });

      setExtraBrowseWardPcode(effectiveSelectedWardPcode);
      setNextCursorId(result.nextCursorId || null);
      setHasMoreOverride(Boolean(result.hasMore));
      setBrowseError("");
    } catch (error) {
      console.error("Failed to load more ERF rows:", error);
      setBrowseError("Failed to load more ERF registry rows.");
    }
  }

  async function handleSearchSubmit(event) {
    event.preventDefault();

    const cleanedSearchText = searchText.trim();

    setSearchError("");
    setSearchRows([]);
    setLastSearchLabel("");
    setWasSearchLimited(false);

    if (!activeLmPcode) {
      setSearchError("No active LM found on your profile.");
      return;
    }

    if (!cleanedSearchText) {
      setSearchError("Please enter an ERF number.");
      return;
    }

    try {
      const result = await searchErfsByLm({
        lmPcode: activeLmPcode,
        searchText: cleanedSearchText,
        erfType: searchType,
        resultLimit: ERF_SEARCH_LIMIT,
      }).unwrap();

      setSearchRows(result.rows || []);
      setWasSearchLimited(Boolean(result.wasLimited));
      setLastSearchLabel(`ERF starts with "${cleanedSearchText}"`);
    } catch (error) {
      console.error("ERF search failed:", error);
      setSearchError("ERF search failed. Check console and Firestore indexes.");
    }
  }

  function handleOpenSearchModal() {
    setIsSearchModalOpen(true);
    setSearchError("");
  }

  function handleCloseSearchModal() {
    setIsSearchModalOpen(false);
  }

  function handleClearSearch() {
    setSearchText("");
    setSearchType("");
    setSearchRows([]);
    setSearchError("");
    setLastSearchLabel("");
    setWasSearchLimited(false);
  }

  function getWardDisplay(wardPcode) {
    const ward = wardLookup.get(wardPcode);

    if (ward?.wardNumber) return `Ward ${ward.wardNumber}`;
    return wardPcode || "NAv";
  }

  const browseTotals = sortedBrowseRows.reduce(
    (accumulator, row) => {
      accumulator.premises += row.premiseCount;
      accumulator.electricityMeters += row.electricityMeterCount;
      accumulator.waterMeters += row.waterMeterCount;
      accumulator.meters += row.meterCount;
      accumulator.trnsAccess += row.trnsAccessCount;
      accumulator.trnsNa += row.trnsNaCount;
      accumulator.trnsTotal += row.trnsTotalCount;
      return accumulator;
    },
    { premises: 0, electricityMeters: 0, waterMeters: 0, meters: 0, trnsAccess: 0, trnsNa: 0, trnsTotal: 0 },
  );

  const quickDownloadColumns = useMemo(
    () => [
      {
        header: "ERF No",
        value: (row) => row.erfNo || "NAv",
      },
      {
        header: "Type",
        value: (row) => row.erfType || "NAv",
      },
      {
        header: "Premises",
        value: (row) => row.premiseCount || 0,
      },
      {
        header: "Electricity",
        value: (row) => row.electricityMeterCount || 0,
      },
      {
        header: "Water",
        value: (row) => row.waterMeterCount || 0,
      },
      {
        header: "Total Meters",
        value: (row) => row.meterCount || 0,
      },
      {
        header: "Access TRNs",
        value: (row) => row.trnsAccessCount || 0,
      },
      {
        header: "No Access",
        value: (row) => row.trnsNaCount || 0,
      },
      {
        header: "Total TRNs",
        value: (row) => row.trnsTotalCount || 0,
      },
      {
        header: "updatedAt",
        value: (row) => formatUpdatedAt(row.updatedAt),
      },
    ],
    [],
  );

  const quickDownloadScope = useMemo(
    () => ({
      lmName: activeWorkbaseName,
      lmPcode: activeLmPcode || "NAv",
      wardLabel: getWardLabel(selectedWard),
      wardPcode: effectiveSelectedWardPcode || "NAv",
    }),
    [activeWorkbaseName, activeLmPcode, selectedWard, effectiveSelectedWardPcode],
  );

  const selectedWardTotalErfs = selectedWard?.totalErfCount || 0;
  const hasBrowseError = Boolean(browseError || firstPageError);

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>ERF Registry</h1>

          <p className="muted">Browse ERFs by ward, or find a specific ERF across the active LM.</p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <button className="primary-button" type="button" onClick={handleOpenSearchModal}>
            Find ERF
          </button>

          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || "NAv"}</div>
          <div className="role-pill">
            {isBrowseFetching ? "Loading..." : `${formatNumber(browseRows.length)} loaded`}
          </div>
          <DownloadButtons
            registryName="ERF Registry"
            rowsLabel="ERFs"
            visibleRows={sortedBrowseRows}
            columns={quickDownloadColumns}
            fileBaseName="erfs_registry"
            scope={quickDownloadScope}
          />
        </div>
      </header>

      <section className="filter-panel">
        <label>
          Browse Ward
          <select
            value={effectiveSelectedWardPcode}
            onChange={handleBrowseWardChange}
            disabled={wardsLoading || wardRows.length === 0}
          >
            <option value="">Select ward</option>

            {wardRows.map((ward) => (
              <option key={ward.wardPcode} value={ward.wardPcode}>
                Ward {ward.wardNumber} · {formatNumber(ward.totalErfCount)} ERFs
              </option>
            ))}
          </select>
        </label>

        <div className="filter-summary">
          <strong>{getWardLabel(selectedWard)}</strong>
          <span>{effectiveSelectedWardPcode || "No ward selected"}</span>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Loaded ERFs</span>
          <strong>{formatNumber(browseRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(sortedBrowseRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Ward Total ERFs</span>
          <strong>{formatNumber(selectedWardTotalErfs)}</strong>
        </div>

        <div className="stat-card">
          <span>Premises Loaded</span>
          <strong>{formatNumber(browseTotals.premises)}</strong>
        </div>

        <div className="stat-card">
          <span>Total Meters Loaded</span>
          <strong>{formatNumber(browseTotals.meters)}</strong>
        </div>

        <div className="stat-card">
          <span>Electricity Loaded</span>
          <strong>{formatNumber(browseTotals.electricityMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>Water Loaded</span>
          <strong>{formatNumber(browseTotals.waterMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>No Access TRNs Loaded</span>
          <strong>{formatNumber(browseTotals.trnsNa)}</strong>
        </div>

        <div className="stat-card">
          <span>Total TRNs Loaded</span>
          <strong>{formatNumber(browseTotals.trnsTotal)}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!effectiveSelectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              ERF Registry browsing is ward-scoped to avoid loading the full LM.
            </p>
          </div>
        ) : null}

        {hasBrowseError ? (
          <div className="empty-state error-box">
            <h2>Could not load ERF registry</h2>
            <p className="muted">{browseError || "Failed to load ERF registry rows."}</p>
          </div>
        ) : null}

        {isBrowseFetching && browseRows.length === 0 ? (
          <div className="empty-state">
            <h2>Loading ERF registry...</h2>
            <p className="muted">Loading first page.</p>
          </div>
        ) : null}

        {!isBrowseFetching && effectiveSelectedWardPcode && browseRows.length === 0 && !hasBrowseError ? (
          <div className="empty-state">
            <h2>No ERF registry rows found</h2>
            <p className="muted">No rows were returned for ward {effectiveSelectedWardPcode}.</p>
          </div>
        ) : null}

        {browseRows.length > 0 ? (
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
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <SortButton label="ERF No" sortKey="erfNo" sortConfig={sortConfig} onSort={handleSort} />
                      <FilterInput value={browseFilters.erfNo} onChange={(value) => updateBrowseFilter("erfNo", value)} placeholder="Filter ERF" />
                    </th>
                    <th>
                      <SortButton label="Type" sortKey="erfType" sortConfig={sortConfig} onSort={handleSort} />
                      <FilterSelect value={browseFilters.erfType} onChange={(value) => updateBrowseFilter("erfType", value)}>
                        <option value="ALL">All</option>
                        <option value="FORMAL">Formal</option>
                        <option value="INFORMAL">Informal</option>
                        <option value="NAV">NAv</option>
                      </FilterSelect>
                    </th>
                    <th>
                      <SortButton label="Premises" sortKey="premiseCount" sortConfig={sortConfig} onSort={handleSort} />
                      <FilterInput value={browseFilters.premiseCount} onChange={(value) => updateBrowseFilter("premiseCount", value)} placeholder="Filter" />
                    </th>
                    <th>
                      <SortButton label="Electricity" sortKey="electricityMeterCount" sortConfig={sortConfig} onSort={handleSort} />
                      <FilterInput value={browseFilters.electricityMeterCount} onChange={(value) => updateBrowseFilter("electricityMeterCount", value)} placeholder="Filter" />
                    </th>
                    <th>
                      <SortButton label="Water" sortKey="waterMeterCount" sortConfig={sortConfig} onSort={handleSort} />
                      <FilterInput value={browseFilters.waterMeterCount} onChange={(value) => updateBrowseFilter("waterMeterCount", value)} placeholder="Filter" />
                    </th>
                    <th>
                      <SortButton label="Total Meters" sortKey="meterCount" sortConfig={sortConfig} onSort={handleSort} />
                      <FilterInput value={browseFilters.meterCount} onChange={(value) => updateBrowseFilter("meterCount", value)} placeholder="Filter" />
                    </th>
                    <th>
                      <SortButton label="Access TRNs" sortKey="trnsAccessCount" sortConfig={sortConfig} onSort={handleSort} />
                      <FilterInput value={browseFilters.trnsAccessCount} onChange={(value) => updateBrowseFilter("trnsAccessCount", value)} placeholder="Filter" />
                    </th>
                    <th>
                      <SortButton label="No Access" sortKey="trnsNaCount" sortConfig={sortConfig} onSort={handleSort} />
                      <FilterInput value={browseFilters.trnsNaCount} onChange={(value) => updateBrowseFilter("trnsNaCount", value)} placeholder="Filter" />
                    </th>
                    <th>
                      <SortButton label="Total TRNs" sortKey="trnsTotalCount" sortConfig={sortConfig} onSort={handleSort} />
                      <FilterInput value={browseFilters.trnsTotalCount} onChange={(value) => updateBrowseFilter("trnsTotalCount", value)} placeholder="Filter" />
                    </th>
                    <th>
                      <SortButton label="updatedAt" sortKey="updatedAt" sortConfig={sortConfig} onSort={handleSort} />
                      <DatetimeFilterButton filter={updatedAtFilter} onClick={() => setIsUpdatedAtFilterOpen(true)} />
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {sortedBrowseRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="muted">
                        No ERFs match the current filters. Clear or adjust a column filter above.
                      </td>
                    </tr>
                  ) : (
                    paginatedBrowseRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.erfNo}</td>
                        <td>{row.erfType}</td>
                        <td>{formatNumber(row.premiseCount)}</td>
                        <td>{formatNumber(row.electricityMeterCount)}</td>
                        <td>{formatNumber(row.waterMeterCount)}</td>
                        <td>{formatNumber(row.meterCount)}</td>
                        <td>{formatNumber(row.trnsAccessCount)}</td>
                        <td>{formatNumber(row.trnsNaCount)}</td>
                        <td>{formatNumber(row.trnsTotalCount)}</td>
                            <td>{formatUpdatedAt(row.updatedAt)}</td>
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

            {activeHasMore || isBrowseFetching ? (
              <div className="load-more-row">
                <div>
                  <strong>
                    {hasActiveBrowseFilters
                      ? `${formatNumber(sortedBrowseRows.length)} filtered from ${formatNumber(browseRows.length)} loaded`
                      : `${formatNumber(browseRows.length)} of ${formatNumber(selectedWardTotalErfs)} ward ERFs loaded`}
                  </strong>
                  <p className="muted">
                    {isBrowseFetching ? "Loading ERFs..." : "More ERFs are available."}
                  </p>
                </div>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleLoadMore}
                  disabled={!activeHasMore || isBrowseFetching}
                >
                  {isBrowseFetching ? "Loading..." : "Load More"}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {isSearchModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card wide-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Find ERF</p>
                <h2>Search across {activeWorkbaseName}</h2>
                <p className="muted">
                  This search is active-LM-wide. It is not restricted to the selected browse ward.
                </p>
              </div>

              <button className="icon-button" type="button" onClick={handleCloseSearchModal}>
                ×
              </button>
            </div>

            <form className="modal-search-form" onSubmit={handleSearchSubmit}>
              <label>
                ERF No
                <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Example: 203 or 203/2" />
              </label>

              <label>
                Type
                <select value={searchType} onChange={(event) => setSearchType(event.target.value)}>
                  <option value="">All</option>
                  <option value="FORMAL">Formal</option>
                  <option value="INFORMAL">Informal</option>
                </select>
              </label>

              <div className="filter-actions">
                <button type="submit" disabled={isSearchFetching}>
                  {isSearchFetching ? "Searching..." : "Search"}
                </button>

                <button type="button" className="ghost-button" onClick={handleClearSearch}>
                  Clear
                </button>
              </div>
            </form>

            {searchError ? (
              <div className="empty-state error-box">
                <h2>Search problem</h2>
                <p className="muted">{searchError}</p>
              </div>
            ) : null}

            {wasSearchLimited ? (
              <div className="notice-panel">
                <strong>Many matches found</strong>
                <p className="muted">
                  Showing the first {formatNumber(ERF_SEARCH_LIMIT)} matches. Refine the ERF number if you need fewer results.
                </p>
              </div>
            ) : null}

            {!searchError && !lastSearchLabel && searchRows.length === 0 ? (
              <div className="empty-state">
                <h2>Search for an ERF</h2>
                <p className="muted">Enter an ERF number. The search will check the full active LM.</p>
              </div>
            ) : null}

            {!isSearchFetching && lastSearchLabel && searchRows.length === 0 && !searchError ? (
              <div className="empty-state">
                <h2>No ERFs found</h2>
                <p className="muted">No registry rows matched {lastSearchLabel}.</p>
              </div>
            ) : null}

            {isSearchFetching ? (
              <div className="empty-state">
                <h2>Searching...</h2>
                <p className="muted">Searching ERFs in active LM.</p>
              </div>
            ) : null}

            {searchRows.length > 0 ? (
              <div className="table-wrap modal-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ERF No</th>
                      <th>Ward</th>
                      <th>Type</th>
                      <th>Premises</th>
                      <th>Electricity</th>
                      <th>Water</th>
                      <th>Total Meters</th>
                      <th>No Access</th>
                      <th>Total TRNs</th>
                      <th>updatedAt</th>
                    </tr>
                  </thead>

                  <tbody>
                    {[...searchRows]
                      .sort((a, b) => compareNatural(a.erfNo, b.erfNo))
                      .map((row) => (
                        <tr key={row.id}>
                          <td>{row.erfNo}</td>
                          <td>{getWardDisplay(row.wardPcode)}</td>
                          <td>{row.erfType}</td>
                          <td>{formatNumber(row.premiseCount)}</td>
                          <td>{formatNumber(row.electricityMeterCount)}</td>
                          <td>{formatNumber(row.waterMeterCount)}</td>
                          <td>{formatNumber(row.meterCount)}</td>
                          <td>{formatNumber(row.trnsNaCount)}</td>
                          <td>{formatNumber(row.trnsTotalCount)}</td>
                                <td>{formatUpdatedAt(row.updatedAt)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isUpdatedAtFilterOpen ? (
        <DatetimeFilterModal
          filter={updatedAtFilter}
          onApply={(nextFilter) => {
            setCurrentPage(1);
            setUpdatedAtFilter(nextFilter);
            setIsUpdatedAtFilterOpen(false);
          }}
          onClear={() => {
            setCurrentPage(1);
            setUpdatedAtFilter(EMPTY_UPDATED_AT_FILTER);
            setIsUpdatedAtFilterOpen(false);
          }}
          onClose={() => setIsUpdatedAtFilterOpen(false)}
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
    paddingBottom: "0.85rem",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
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
