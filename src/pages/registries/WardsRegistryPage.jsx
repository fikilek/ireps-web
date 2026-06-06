import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

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
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

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

function sortByUpdatedAtDesc(a, b) {
  const updatedCompare = getUpdatedAtMs(b.updatedAt) - getUpdatedAtMs(a.updatedAt);

  if (updatedCompare !== 0) return updatedCompare;

  return compareNatural(Number(a.wardNumber) || 0, Number(b.wardNumber) || 0);
}

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig?.key === sortKey;
  const arrow = !isActive ? "↕" : sortConfig.direction === "asc" ? "↑" : "↓";

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      style={styles.sortButton}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span>{arrow}</span>
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

export default function WardsRegistryPage() {
  const { activeWorkbase } = useAuth();
  const [sortConfig, setSortConfig] = useState({
    key: "updatedAt",
    direction: "desc",
  });
  const [filters, setFilters] = useState({
    wardNumber: "",
    formalErfCount: "",
    informalErfCount: "",
    totalErfCount: "",
    premiseCount: "",
    electricityMeterCount: "",
    waterMeterCount: "",
    meterCount: "",
    trnCount: "",
    updatedAt: "",
  });

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
      const wardMatch =
        includesText(row.wardNumber, filters.wardNumber) ||
        includesText(row.wardName, filters.wardNumber) ||
        includesText(row.wardPcode, filters.wardNumber);

      return (
        wardMatch &&
        includesText(getCountText(row.formalErfCount), filters.formalErfCount) &&
        includesText(getCountText(row.informalErfCount), filters.informalErfCount) &&
        includesText(getCountText(row.totalErfCount), filters.totalErfCount) &&
        includesText(getCountText(row.premiseCount), filters.premiseCount) &&
        includesText(
          getCountText(row.electricityMeterCount),
          filters.electricityMeterCount,
        ) &&
        includesText(getCountText(row.waterMeterCount), filters.waterMeterCount) &&
        includesText(getCountText(row.meterCount), filters.meterCount) &&
        includesText(getCountText(row.trnCount), filters.trnCount) &&
        includesText(formatUpdatedAt(row.updatedAt), filters.updatedAt)
      );
    });
  }, [wardRows, filters]);

  const sortedWardRows = useMemo(() => {
    if (!sortConfig?.key) {
      return [...filteredWardRows].sort(sortByUpdatedAtDesc);
    }

    const rows = [...filteredWardRows];

    rows.sort((a, b) => {
      const result = compareNatural(
        getSortValue(a, sortConfig.key),
        getSortValue(b, sortConfig.key),
      );

      return sortConfig.direction === "asc" ? result : -result;
    });

    return rows;
  }, [filteredWardRows, sortConfig]);

  const totals = wardRows.reduce(
    (accumulator, row) => {
      accumulator.totalErfs += row.totalErfCount;
      accumulator.premises += row.premiseCount;
      accumulator.electricityMeters += row.electricityMeterCount;
      accumulator.waterMeters += row.waterMeterCount;
      accumulator.meters += row.meterCount;
      accumulator.trns += row.trnCount;
      return accumulator;
    },
    {
      totalErfs: 0,
      premises: 0,
      electricityMeters: 0,
      waterMeters: 0,
      meters: 0,
      trns: 0,
    },
  );

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSort(key) {
    setSortConfig((current) => {
      if (current.key !== key) {
        return { key, direction: "asc" };
      }

      return {
        key,
        direction: current.direction === "asc" ? "desc" : "asc",
      };
    });
  }

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>Ward Registry</h1>
          <p className="muted">
            Showing backend-shaped ward registry rows for {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="role-pill">
          {isFetching ? "Streaming..." : `${formatNumber(sortedWardRows.length)} wards`}
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

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
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
              Check Firestore rules, the registry_wards collection, or the LM
              field used by the query.
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

        {!isLoading &&
        activeLmPcode &&
        wardRows.length > 0 &&
        sortedWardRows.length === 0 &&
        !error ? (
          <div className="empty-state">
            <h2>No wards match the current filters</h2>
            <p className="muted">Adjust the column filters to widen the results.</p>
          </div>
        ) : null}

        {sortedWardRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <SortButton
                      label="Ward"
                      sortKey="wardNumber"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.wardNumber}
                      onChange={(value) => updateFilter("wardNumber", value)}
                      placeholder="Ward"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Formal ERFs"
                      sortKey="formalErfCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.formalErfCount}
                      onChange={(value) => updateFilter("formalErfCount", value)}
                      placeholder="Filter"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Informal ERFs"
                      sortKey="informalErfCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.informalErfCount}
                      onChange={(value) => updateFilter("informalErfCount", value)}
                      placeholder="Filter"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Total ERFs"
                      sortKey="totalErfCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.totalErfCount}
                      onChange={(value) => updateFilter("totalErfCount", value)}
                      placeholder="Filter"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Premises"
                      sortKey="premiseCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.premiseCount}
                      onChange={(value) => updateFilter("premiseCount", value)}
                      placeholder="Filter"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Electricity"
                      sortKey="electricityMeterCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.electricityMeterCount}
                      onChange={(value) => updateFilter("electricityMeterCount", value)}
                      placeholder="Filter"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Water"
                      sortKey="waterMeterCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.waterMeterCount}
                      onChange={(value) => updateFilter("waterMeterCount", value)}
                      placeholder="Filter"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Total Meters"
                      sortKey="meterCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.meterCount}
                      onChange={(value) => updateFilter("meterCount", value)}
                      placeholder="Filter"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="TRNs"
                      sortKey="trnCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.trnCount}
                      onChange={(value) => updateFilter("trnCount", value)}
                      placeholder="Filter"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Updated"
                      sortKey="updatedAt"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.updatedAt}
                      onChange={(value) => updateFilter("updatedAt", value)}
                      placeholder="YYYY-MM-DD"
                    />
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedWardRows.map((row) => (
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
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
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
};
