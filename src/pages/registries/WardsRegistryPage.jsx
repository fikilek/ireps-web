import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import {
  DatetimeFilterButton,
  DatetimeFilterModal,
} from "../../components/DatetimeFilter";
import DownloadButtons from "../../components/DownloadButtons";

const EMPTY_WARD_FILTERS = {
  wardNumber: "",
  formalErfCount: "",
  informalErfCount: "",
  totalErfCount: "",
  premiseCount: "",
  electricityMeterCount: "",
  waterMeterCount: "",
  meterCount: "",
  trnCount: "",
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

function compareNatural(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;

  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getSortValue(row, key) {
  if (key === "wardNumber") return Number(row.wardNumber) || 0;
  if (key === "formalErfCount") return row.formalErfCount || 0;
  if (key === "informalErfCount") return row.informalErfCount || 0;
  if (key === "totalErfCount") return row.totalErfCount || 0;
  if (key === "premiseCount") return row.premiseCount || 0;
  if (key === "electricityMeterCount") return row.electricityMeterCount || 0;
  if (key === "waterMeterCount") return row.waterMeterCount || 0;
  if (key === "meterCount") return row.meterCount || 0;
  if (key === "trnCount") return row.trnCount || 0;
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

export default function WardsRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const [sortConfig, setSortConfig] = useState({ key: "updatedAt", direction: "desc" });
  const [filters, setFilters] = useState(EMPTY_WARD_FILTERS);
  const [updatedAtFilter, setUpdatedAtFilter] = useState(EMPTY_UPDATED_AT_FILTER);
  const [isUpdatedAtFilterOpen, setIsUpdatedAtFilterOpen] = useState(false);

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const {
    data: wardRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const filteredWardRows = useMemo(() => {
    return wardRows.filter((row) => {
      return (
        includesText(row.wardNumber, filters.wardNumber) &&
        includesText(getCountText(row.formalErfCount), filters.formalErfCount) &&
        includesText(getCountText(row.informalErfCount), filters.informalErfCount) &&
        includesText(getCountText(row.totalErfCount), filters.totalErfCount) &&
        includesText(getCountText(row.premiseCount), filters.premiseCount) &&
        includesText(getCountText(row.electricityMeterCount), filters.electricityMeterCount) &&
        includesText(getCountText(row.waterMeterCount), filters.waterMeterCount) &&
        includesText(getCountText(row.meterCount), filters.meterCount) &&
        includesText(getCountText(row.trnCount), filters.trnCount) &&
        matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter)
      );
    });
  }, [wardRows, filters, updatedAtFilter]);

  const sortedWardRows = useMemo(() => {
    const rows = [...filteredWardRows];

    rows.sort((a, b) => {
      const comparison = compareNatural(getSortValue(a, sortConfig.key), getSortValue(b, sortConfig.key));
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [filteredWardRows, sortConfig]);

  const totals = sortedWardRows.reduce(
    (accumulator, row) => {
      accumulator.totalErfs += row.totalErfCount;
      accumulator.premises += row.premiseCount;
      accumulator.electricityMeters += row.electricityMeterCount;
      accumulator.waterMeters += row.waterMeterCount;
      accumulator.meters += row.meterCount;
      accumulator.trns += row.trnCount;
      return accumulator;
    },
    { totalErfs: 0, premises: 0, electricityMeters: 0, waterMeters: 0, meters: 0, trns: 0 },
  );

  const quickDownloadColumns = useMemo(
    () => [
      {
        header: "Ward",
        value: (row) => row.wardNumber || "NAv",
      },
      {
        header: "Formal ERFs",
        value: (row) => row.formalErfCount || 0,
      },
      {
        header: "Informal ERFs",
        value: (row) => row.informalErfCount || 0,
      },
      {
        header: "Total ERFs",
        value: (row) => row.totalErfCount || 0,
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
        header: "TRNs",
        value: (row) => row.trnCount || 0,
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
      wardLabel: "All wards",
      wardPcode: "NAv",
    }),
    [activeWorkbaseName, activeLmPcode],
  );

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(sortKey) {
    setSortConfig((current) => {
      if (current.key !== sortKey) return { key: sortKey, direction: "asc" };
      if (current.direction === "asc") return { key: sortKey, direction: "desc" };
      return { key: "updatedAt", direction: "desc" };
    });
  }

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>Ward Registry</h1>
          <p className="muted">Showing backend-shaped ward registry rows.</p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || "NAv"}</div>
          <div className="role-pill">
            {isFetching ? "Streaming..." : `${formatNumber(sortedWardRows.length)} wards`}
          </div>
          <DownloadButtons
            registryName="Ward Registry"
            rowsLabel="wards"
            visibleRows={sortedWardRows}
            columns={quickDownloadColumns}
            fileBaseName="wards_registry"
            scope={quickDownloadScope}
          />
        </div>
      </header>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Wards</span>
          <strong>{formatNumber(wardRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(sortedWardRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Total ERFs</span>
          <strong>{formatNumber(totals.totalErfs)}</strong>
        </div>

        <div className="stat-card">
          <span>Premises</span>
          <strong>{formatNumber(totals.premises)}</strong>
        </div>

        <div className="stat-card">
          <span>Total Meters</span>
          <strong>{formatNumber(totals.meters)}</strong>
        </div>

        <div className="stat-card">
          <span>Electricity Meters</span>
          <strong>{formatNumber(totals.electricityMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>Water Meters</span>
          <strong>{formatNumber(totals.waterMeters)}</strong>
        </div>

        <div className="stat-card">
          <span>TRNs</span>
          <strong>{formatNumber(totals.trns)}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!activeLmPcode ? (
          <div className="empty-state">
            <h2>No active workbase</h2>
            <p className="muted">
              Your profile does not currently have an active LM/workbase.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load ward registry</h2>
            <p className="muted">
              Check Firestore rules, the registry_wards collection, or the LM field used by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading ward registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading && activeLmPcode && wardRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No ward registry rows found</h2>
            <p className="muted">
              No rows were returned for LM {activeLmPcode}.
            </p>
          </div>
        ) : null}

        {wardRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <SortButton label="Ward" sortKey="wardNumber" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.wardNumber} onChange={(value) => updateFilter("wardNumber", value)} placeholder="Ward" />
                  </th>
                  <th>
                    <SortButton label="Formal ERFs" sortKey="formalErfCount" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.formalErfCount} onChange={(value) => updateFilter("formalErfCount", value)} placeholder="Filter" />
                  </th>
                  <th>
                    <SortButton label="Informal ERFs" sortKey="informalErfCount" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.informalErfCount} onChange={(value) => updateFilter("informalErfCount", value)} placeholder="Filter" />
                  </th>
                  <th>
                    <SortButton label="Total ERFs" sortKey="totalErfCount" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.totalErfCount} onChange={(value) => updateFilter("totalErfCount", value)} placeholder="Filter" />
                  </th>
                  <th>
                    <SortButton label="Premises" sortKey="premiseCount" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.premiseCount} onChange={(value) => updateFilter("premiseCount", value)} placeholder="Filter" />
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
                    <SortButton label="TRNs" sortKey="trnCount" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.trnCount} onChange={(value) => updateFilter("trnCount", value)} placeholder="Filter" />
                  </th>
                  <th>
                    <SortButton label="updatedAt" sortKey="updatedAt" sortConfig={sortConfig} onSort={handleSort} />
                    <DatetimeFilterButton filter={updatedAtFilter} onClick={() => setIsUpdatedAtFilterOpen(true)} />
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedWardRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="muted">
                      No wards match the current filters. Clear or adjust a column filter above.
                    </td>
                  </tr>
                ) : (
                  sortedWardRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.wardNumber}</td>
                      <td>{formatNumber(row.formalErfCount)}</td>
                      <td>{formatNumber(row.informalErfCount)}</td>
                      <td>{formatNumber(row.totalErfCount)}</td>
                      <td>{formatNumber(row.premiseCount)}</td>
                      <td>{formatNumber(row.electricityMeterCount)}</td>
                      <td>{formatNumber(row.waterMeterCount)}</td>
                      <td>{formatNumber(row.meterCount)}</td>
                      <td>{formatNumber(row.trnCount)}</td>
                        <td>{formatUpdatedAt(row.updatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {isUpdatedAtFilterOpen ? (
        <DatetimeFilterModal
          filter={updatedAtFilter}
          onApply={(nextFilter) => {
            setUpdatedAtFilter(nextFilter);
            setIsUpdatedAtFilterOpen(false);
          }}
          onClear={() => {
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
};
