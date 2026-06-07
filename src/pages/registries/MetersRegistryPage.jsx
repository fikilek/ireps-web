import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryMetersByWardQuery } from "../../redux/registryMetersApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import {
  DatetimeFilterButton,
  DatetimeFilterModal,
} from "../../components/DatetimeFilter";
import DownloadButtons from "../../components/DownloadButtons";

const EMPTY_METER_FILTERS = {
  meterNo: "",
  meterType: "ALL",
  visibility: "ALL",
  status: "ALL",
  erfNo: "",
  premiseAddress: "",
  premiseType: "",
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

function getMeterTypeLabel(meterType) {
  if (meterType === "electricity") return "Electricity";
  if (meterType === "water") return "Water";
  return meterType || "NAv";
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
  if (key === "meterNo") return row.meterNo || "";
  if (key === "meterType") return getMeterTypeLabel(row.meterType);
  if (key === "visibility") return row.visibility || "";
  if (key === "status") return row.statusState || row.status || "";
  if (key === "erfNo") return row.erfNo || "";
  if (key === "premiseAddress") return row.premiseAddress || "";
  if (key === "premiseType") return row.premisePropertyType || "";
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

export default function MetersRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);
  const [sortConfig, setSortConfig] = useState({ key: "updatedAt", direction: "desc" });
  const [filters, setFilters] = useState(EMPTY_METER_FILTERS);
  const [updatedAtFilter, setUpdatedAtFilter] = useState(EMPTY_UPDATED_AT_FILTER);
  const [isUpdatedAtFilterOpen, setIsUpdatedAtFilterOpen] = useState(false);

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
    data: meterRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryMetersByWardQuery(effectiveSelectedWardPcode || skipToken);

  useEffect(() => {
    setFilters(EMPTY_METER_FILTERS);
    setUpdatedAtFilter(EMPTY_UPDATED_AT_FILTER);
    setSortConfig({ key: "updatedAt", direction: "desc" });
  }, [effectiveSelectedWardPcode]);

  const filteredMeterRows = useMemo(() => {
    return meterRows.filter((row) => {
      const statusText = row.statusState || row.status || "NAv";

      return (
        includesText(row.meterNo, filters.meterNo) &&
        (filters.meterType === "ALL" || String(row.meterType || "").toLowerCase() === filters.meterType.toLowerCase()) &&
        (filters.visibility === "ALL" || String(row.visibility || "").toUpperCase() === filters.visibility) &&
        (filters.status === "ALL" || String(statusText || "").toUpperCase() === filters.status) &&
        includesText(row.erfNo, filters.erfNo) &&
        includesText(`${row.premiseAddress || ""} ${row.premiseId || ""}`, filters.premiseAddress) &&
        includesText(row.premisePropertyType, filters.premiseType) &&
        matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter)
      );
    });
  }, [meterRows, filters, updatedAtFilter]);

  const sortedMeterRows = useMemo(() => {
    const rows = [...filteredMeterRows];

    rows.sort((a, b) => {
      const comparison = compareNatural(getSortValue(a, sortConfig.key), getSortValue(b, sortConfig.key));
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [filteredMeterRows, sortConfig]);

  const totals = sortedMeterRows.reduce(
    (accumulator, row) => {
      if (row.meterType === "electricity") accumulator.electricity += 1;
      if (row.meterType === "water") accumulator.water += 1;
      if (row.visibility === "VISIBLE") accumulator.visible += 1;
      if (row.visibility === "INVISIBLE") accumulator.invisible += 1;
      return accumulator;
    },
    { electricity: 0, water: 0, visible: 0, invisible: 0 },
  );

  const quickDownloadColumns = useMemo(
    () => [
      {
        header: "Meter No",
        value: (row) => row.meterNo || "NAv",
      },
      {
        header: "Type",
        value: (row) => getMeterTypeLabel(row.meterType),
      },
      {
        header: "Visibility",
        value: (row) => row.visibility || "NAv",
      },
      {
        header: "Status",
        value: (row) => row.statusState || row.status || "NAv",
      },
      {
        header: "ERF No",
        value: (row) => row.erfNo || "NAv",
      },
      {
        header: "Premise Address",
        value: (row) => {
          const address = row.premiseAddress || "NAv";
          const premiseId = row.premiseId || "NAv";
          return `${address}
${premiseId}`;
        },
      },
      {
        header: "Premise Type",
        value: (row) => row.premisePropertyType || "NAv",
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
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(sortKey) {
    setSortConfig((current) => {
      if (current.key !== sortKey) return { key: sortKey, direction: "asc" };
      if (current.direction === "asc") return { key: sortKey, direction: "desc" };
      return { key: "updatedAt", direction: "desc" };
    });
  }

  function handleWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard = wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>Meter Registry</h1>

          <p className="muted">Showing backend-shaped meter registry rows.</p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || "NAv"}</div>
          <div className="role-pill">
            {isFetching ? "Streaming..." : `${formatNumber(sortedMeterRows.length)} meters`}
          </div>
          <DownloadButtons
            registryName="Meter Registry"
            rowsLabel="meters"
            visibleRows={sortedMeterRows}
            columns={quickDownloadColumns}
            fileBaseName="meters_registry"
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
                Ward {ward.wardNumber} · {formatNumber(ward.meterCount)} meters
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
          <span>Meters</span>
          <strong>{formatNumber(meterRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(sortedMeterRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Ward Meter Count</span>
          <strong>{formatNumber(selectedWard?.meterCount || 0)}</strong>
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
          <span>Visible</span>
          <strong>{formatNumber(totals.visible)}</strong>
        </div>

        <div className="stat-card">
          <span>Invisible</span>
          <strong>{formatNumber(totals.invisible)}</strong>
        </div>

        <div className="stat-card">
          <span>Selected Ward</span>
          <strong>{selectedWard?.wardNumber || "NAv"}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!effectiveSelectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Meter Registry is ward-scoped for clean operational browsing.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load meter registry</h2>
            <p className="muted">
              Check Firestore rules, registry_meters, or the ward field used by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading meter registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading && effectiveSelectedWardPcode && meterRows.length === 0 && !error ? (
          <div className="empty-state">
            <h2>No meter registry rows found</h2>
            <p className="muted">
              No meters were returned for ward {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {meterRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <SortButton label="Meter No" sortKey="meterNo" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.meterNo} onChange={(value) => updateFilter("meterNo", value)} placeholder="Meter no" />
                  </th>
                  <th>
                    <SortButton label="Type" sortKey="meterType" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterSelect value={filters.meterType} onChange={(value) => updateFilter("meterType", value)}>
                      <option value="ALL">All</option>
                      <option value="electricity">Electricity</option>
                      <option value="water">Water</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton label="Visibility" sortKey="visibility" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterSelect value={filters.visibility} onChange={(value) => updateFilter("visibility", value)}>
                      <option value="ALL">All</option>
                      <option value="VISIBLE">Visible</option>
                      <option value="INVISIBLE">Invisible</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton label="Status" sortKey="status" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterSelect value={filters.status} onChange={(value) => updateFilter("status", value)}>
                      <option value="ALL">All</option>
                      <option value="FIELD">FIELD</option>
                      <option value="CONNECTED">CONNECTED</option>
                      <option value="DISCONNECTED">DISCONNECTED</option>
                      <option value="REMOVED">REMOVED</option>
                      <option value="DECOMMISSIONED">DECOMMISSIONED</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton label="ERF No" sortKey="erfNo" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.erfNo} onChange={(value) => updateFilter("erfNo", value)} placeholder="ERF" />
                  </th>
                  <th>
                    <SortButton label="Premise Address" sortKey="premiseAddress" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.premiseAddress} onChange={(value) => updateFilter("premiseAddress", value)} placeholder="Address / ID" />
                  </th>
                  <th>
                    <SortButton label="Premise Type" sortKey="premiseType" sortConfig={sortConfig} onSort={handleSort} />
                    <FilterInput value={filters.premiseType} onChange={(value) => updateFilter("premiseType", value)} placeholder="Type" />
                  </th>
                  <th>
                    <SortButton label="updatedAt" sortKey="updatedAt" sortConfig={sortConfig} onSort={handleSort} />
                    <DatetimeFilterButton filter={updatedAtFilter} onClick={() => setIsUpdatedAtFilterOpen(true)} />
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedMeterRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      No meters match the current filters. Clear or adjust a column filter above.
                    </td>
                  </tr>
                ) : (
                  sortedMeterRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.meterNo}</td>
                      <td>{getMeterTypeLabel(row.meterType)}</td>
                      <td>{row.visibility}</td>
                      <td>{row.statusState || row.status || "NAv"}</td>
                      <td>{row.erfNo}</td>
                      <td>
                        <strong>{row.premiseAddress || "NAv"}</strong>
                        <div className="muted" style={styles.smallMuted}>
                          {row.premiseId || "NAv"}
                        </div>
                      </td>
                      <td>{row.premisePropertyType}</td>
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
    paddingRight: "1.25rem",
    paddingBottom: "0.85rem",
    paddingLeft: "1.25rem",
    boxSizing: "border-box",
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
  smallMuted: {
    fontSize: "0.72rem",
    marginTop: "0.25rem",
  },
};
