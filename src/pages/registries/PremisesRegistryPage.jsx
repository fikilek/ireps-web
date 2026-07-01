import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryPremisesByWardQuery } from "../../redux/registryPremisesApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import {
  DatetimeFilterButton,
  DatetimeFilterModal,
} from "../../components/DatetimeFilter";
import DownloadButtons from "../../components/DownloadButtons";

const EMPTY_PREMISE_FILTERS = {
  erfNo: "",
  addressText: "",
  propertyTypeType: "",
  propertyTypeName: "",
  unitNo: "",
  occupancyStatus: "ALL",
  electricityMeterCount: "",
  waterMeterCount: "",
  meterCount: "",
};

const DEFAULT_SORT = { key: "updatedAt", direction: "desc" };
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;

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
  if (key === "addressText") return row.addressText || "";
  if (key === "propertyTypeType") return row.propertyTypeType || "";
  if (key === "propertyTypeName") return row.propertyTypeName || "";
  if (key === "unitNo") return row.unitNo || "";
  if (key === "occupancyStatus") return row.occupancyStatus || "";
  if (key === "electricityMeterCount") return row.electricityMeterCount || 0;
  if (key === "waterMeterCount") return row.waterMeterCount || 0;
  if (key === "meterCount") return row.meterCount || 0;
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

export default function PremisesRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const [filters, setFilters] = useState(EMPTY_PREMISE_FILTERS);
  const [updatedAtFilter, setUpdatedAtFilter] = useState(EMPTY_UPDATED_AT_FILTER);
  const [isUpdatedAtFilterOpen, setIsUpdatedAtFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

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

  const {
    data: premiseRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryPremisesByWardQuery(effectiveSelectedWardPcode || skipToken);

  const filteredPremiseRows = useMemo(() => {
    return premiseRows.filter((row) => {
      return (
        includesText(row.erfNo, filters.erfNo) &&
        includesText(`${row.addressText || ""} ${row.premiseId || ""}`, filters.addressText) &&
        includesText(row.propertyTypeType, filters.propertyTypeType) &&
        includesText(row.propertyTypeName, filters.propertyTypeName) &&
        includesText(row.unitNo, filters.unitNo) &&
        (filters.occupancyStatus === "ALL" || String(row.occupancyStatus || "").toUpperCase() === filters.occupancyStatus) &&
        includesText(getCountText(row.electricityMeterCount), filters.electricityMeterCount) &&
        includesText(getCountText(row.waterMeterCount), filters.waterMeterCount) &&
        includesText(getCountText(row.meterCount), filters.meterCount) &&
        matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter)
      );
    });
  }, [premiseRows, filters, updatedAtFilter]);

  const sortedPremiseRows = useMemo(() => {
    const rows = [...filteredPremiseRows];

    rows.sort((a, b) => {
      const comparison = compareNatural(getSortValue(a, sortConfig.key), getSortValue(b, sortConfig.key));
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [filteredPremiseRows, sortConfig]);

  const totalRows = sortedPremiseRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = totalRows === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalRows);
  const paginatedPremiseRows = useMemo(() => {
    return sortedPremiseRows.slice(pageStartIndex, pageEndIndex);
  }, [sortedPremiseRows, pageStartIndex, pageEndIndex]);

  const totals = sortedPremiseRows.reduce(
    (accumulator, row) => {
      accumulator.electricityMeters += row.electricityMeterCount;
      accumulator.waterMeters += row.waterMeterCount;
      accumulator.meters += row.meterCount;
      if (row.occupancyStatus === "Accessed") accumulator.accessed += 1;
      if (row.occupancyStatus === "Occupied") accumulator.occupied += 1;
      return accumulator;
    },
    { electricityMeters: 0, waterMeters: 0, meters: 0, accessed: 0, occupied: 0 },
  );

  const quickDownloadColumns = useMemo(
    () => [
      {
        header: "Premise Address",
        value: (row) => {
          const address = row.addressText || "NAv";
          const premiseId = row.premiseId || "NAv";
          return `${address}\n${premiseId}`;
        },
      },
      {
        header: "ERF No",
        value: (row) => row.erfNo || "NAv",
      },
      {
        header: "Property Type",
        value: (row) => row.propertyTypeType || "NAv",
      },
      {
        header: "Name",
        value: (row) => row.propertyTypeName || "NAv",
      },
      {
        header: "Unit",
        value: (row) => row.unitNo || "NAv",
      },
      {
        header: "Occupancy",
        value: (row) => row.occupancyStatus || "NAv",
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

  function updateFilter(key, value) {
    setCurrentPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetTableControls() {
    setFilters(EMPTY_PREMISE_FILTERS);
    setUpdatedAtFilter(EMPTY_UPDATED_AT_FILTER);
    setSortConfig(DEFAULT_SORT);
    setCurrentPage(1);
  }

  function handleSort(sortKey) {
    setCurrentPage(1);
    setSortConfig((current) => {
      if (current.key !== sortKey) return { key: sortKey, direction: "asc" };
      if (current.direction === "asc") return { key: sortKey, direction: "desc" };
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

  function handleWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard = wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    resetTableControls();

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>Premise Registry</h1>

          <p className="muted">Showing backend-shaped premise registry rows.</p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || "NAv"}</div>
          <div className="role-pill">
            {isFetching ? "Streaming..." : `${formatNumber(sortedPremiseRows.length)} premises`}
          </div>
          <DownloadButtons
            registryName="Premise Registry"
            rowsLabel="premises"
            visibleRows={sortedPremiseRows}
            columns={quickDownloadColumns}
            fileBaseName="premises_registry"
            scope={quickDownloadScope}
          />
        </div>
      </header>

      <section className="filter-panel">
        <label>
          Ward
          <select
            value={effectiveSelectedWardPcode}
            onChange={handleWardChange}
            disabled={wardsLoading || wardRows.length === 0}
          >
            <option value="">Select ward</option>

            {wardRows.map((ward) => (
              <option key={ward.wardPcode} value={ward.wardPcode}>
                Ward {ward.wardNumber} · {formatNumber(ward.premiseCount)} premises
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
          <span>Premises</span>
          <strong>{formatNumber(premiseRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(sortedPremiseRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Ward Premise Count</span>
          <strong>{formatNumber(selectedWard?.premiseCount || 0)}</strong>
        </div>

        <div className="stat-card">
          <span>Total Meters</span>
          <strong>{formatNumber(totals.meters)}</strong>
        </div>

        <div className="stat-card">
          <span>Electricity</span>
          <strong>{formatNumber(totals.electricityMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>Water</span>
          <strong>{formatNumber(totals.waterMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>Accessed</span>
          <strong>{formatNumber(totals.accessed)}</strong>
        </div>

        <div className="stat-card">
          <span>Occupied</span>
          <strong>{formatNumber(totals.occupied)}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!effectiveSelectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Premise Registry is ward-scoped for clean operational browsing.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load premise registry</h2>
            <p className="muted">
              Check Firestore rules, registry_premises, or the ward field used by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading premise registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading && effectiveSelectedWardPcode && premiseRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No premise registry rows found</h2>
            <p className="muted">
              No premises were returned for ward {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {premiseRows.length > 0 ? (
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
                    <SortButton label="Premise Address" sortKey="addressText" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.addressText} onChange={(value) => updateFilter("addressText", value)} placeholder="Address / ID" />
                  </th>
                  <th>
                    <SortButton label="ERF No" sortKey="erfNo" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.erfNo} onChange={(value) => updateFilter("erfNo", value)} placeholder="ERF" />
                  </th>
                  <th>
                    <SortButton label="Property Type" sortKey="propertyTypeType" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.propertyTypeType} onChange={(value) => updateFilter("propertyTypeType", value)} placeholder="Type" />
                  </th>
                  <th>
                    <SortButton label="Name" sortKey="propertyTypeName" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.propertyTypeName} onChange={(value) => updateFilter("propertyTypeName", value)} placeholder="Name" />
                  </th>
                  <th>
                    <SortButton label="Unit" sortKey="unitNo" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.unitNo} onChange={(value) => updateFilter("unitNo", value)} placeholder="Unit" />
                  </th>
                  <th>
                    <SortButton label="Occupancy" sortKey="occupancyStatus" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterSelect value={filters.occupancyStatus} onChange={(value) => updateFilter("occupancyStatus", value)}>
                      <option value="ALL">All</option>
                      <option value="ACCESSED">Accessed</option>
                      <option value="OCCUPIED">Occupied</option>
                      <option value="VACANT">Vacant</option>
                      <option value="NAV">NAv</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton label="Electricity" sortKey="electricityMeterCount" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.electricityMeterCount} onChange={(value) => updateFilter("electricityMeterCount", value)} placeholder="Filter" />
                  </th>
                  <th>
                    <SortButton label="Water" sortKey="waterMeterCount" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.waterMeterCount} onChange={(value) => updateFilter("waterMeterCount", value)} placeholder="Filter" />
                  </th>
                  <th>
                    <SortButton label="Total Meters" sortKey="meterCount" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.meterCount} onChange={(value) => updateFilter("meterCount", value)} placeholder="Filter" />
                  </th>
                  <th>
                    <SortButton label="updatedAt" sortKey="updatedAt" sortConfig={sortConfig} onSort={handleSort} />
                    <DatetimeFilterButton filter={updatedAtFilter} onClick={() => setIsUpdatedAtFilterOpen(true)} />
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedPremiseRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="muted">
                      No premises match the current filters. Clear or adjust a column filter above.
                    </td>
                  </tr>
                ) : (
                  paginatedPremiseRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.addressText || "NAv"}</strong>
                        <div className="muted" style={styles.smallMuted}>
                          {row.premiseId || "NAv"}
                        </div>
                      </td>
                      <td>{row.erfNo}</td>
                      <td>{row.propertyTypeType}</td>
                      <td>{row.propertyTypeName}</td>
                      <td>{row.unitNo}</td>
                      <td>{row.occupancyStatus}</td>
                      <td>{formatNumber(row.electricityMeterCount)}</td>
                      <td>{formatNumber(row.waterMeterCount)}</td>
                      <td>{formatNumber(row.meterCount)}</td>
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
          </>
        ) : null}
      </section>

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
  smallMuted: {
    fontSize: "0.72rem",
    marginTop: "0.25rem",
  },
};
