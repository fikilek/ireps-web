import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryPremisesByWardQuery } from "../../redux/registryPremisesApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

function getWardNumberFromPcode(wardPcode = "") {
  const match = String(wardPcode || "").match(/(\d{1,3})$/);
  const numberValue = Number(match?.[1] || 0);

  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getSelectedWardPcodeFromGeo(geoState) {
  const selectedWard = geoState?.selectedWard || null;

  return (
    selectedWard?.id ||
    selectedWard?.pcode ||
    selectedWard?.wardPcode ||
    ""
  );
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

const EMPTY_PREMISE_FILTERS = {
  premiseAddress: "",
  erfNo: "",
  propertyType: "",
  propertyName: "",
  unitNo: "",
  occupancyStatus: "ALL",
  electricityMeterCountMode: "ALL",
  waterMeterCountMode: "ALL",
  meterCountMode: "ALL",
  createdByUser: "",
  updatedAt: "",
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

function countFilterMatches(count, mode) {
  if (!mode || mode === "ALL") return true;
  if (mode === "ZERO") return Number(count || 0) === 0;
  if (mode === "ONE") return Number(count || 0) === 1;
  if (mode === "MULTIPLE") return Number(count || 0) > 1;

  return true;
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
  if (key === "premiseAddress") return row.addressText || "";
  if (key === "erfNo") return row.erfNo || "";
  if (key === "propertyType") return row.propertyTypeType || "";
  if (key === "propertyName") return row.propertyTypeName || "";
  if (key === "unitNo") return row.unitNo || "";
  if (key === "occupancyStatus") return row.occupancyStatus || "";
  if (key === "electricityMeterCount") return row.electricityMeterCount || 0;
  if (key === "waterMeterCount") return row.waterMeterCount || 0;
  if (key === "meterCount") return row.meterCount || 0;
  if (key === "createdByUser") return row.createdByUser || "";
  if (key === "updatedAt") return getUpdatedAtMs(row.updatedAt);

  return "";
}

function sortByUpdatedAtDesc(a, b) {
  const updatedCompare = getUpdatedAtMs(b.updatedAt) - getUpdatedAtMs(a.updatedAt);

  if (updatedCompare !== 0) return updatedCompare;

  return String(a.erfNo || "").localeCompare(String(b.erfNo || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
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

export default function PremisesRegistryPage() {
  const { activeWorkbase } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);
  const previousWardPcodeRef = useRef(selectedWardPcode);
  const [sortConfig, setSortConfig] = useState({
    key: "updatedAt",
    direction: "desc",
  });
  const [filters, setFilters] = useState(EMPTY_PREMISE_FILTERS);

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
    const registryWard =
      wardRows.find((ward) => ward.wardPcode === selectedWardPcode) || null;

    return buildRegistryWardSelection(registryWard, selectedWardPcode);
  }, [wardRows, selectedWardPcode]);

  const effectiveSelectedWardPcode = selectedWard?.wardPcode || "";

  useEffect(() => {
    if (previousWardPcodeRef.current === effectiveSelectedWardPcode) return;

    previousWardPcodeRef.current = effectiveSelectedWardPcode;
    setFilters(EMPTY_PREMISE_FILTERS);
  }, [effectiveSelectedWardPcode]);

  const {
    data: premiseRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryPremisesByWardQuery(
    effectiveSelectedWardPcode || skipToken,
  );

  const filteredPremiseRows = useMemo(() => {
    return premiseRows.filter((row) => {
      const premiseAddressMatch =
        includesText(row.addressText, filters.premiseAddress) ||
        includesText(row.premiseId, filters.premiseAddress);

      return (
        premiseAddressMatch &&
        includesText(row.erfNo, filters.erfNo) &&
        includesText(row.propertyTypeType, filters.propertyType) &&
        includesText(row.propertyTypeName, filters.propertyName) &&
        includesText(row.unitNo, filters.unitNo) &&
        (filters.occupancyStatus === "ALL" ||
          row.occupancyStatus === filters.occupancyStatus) &&
        countFilterMatches(
          row.electricityMeterCount,
          filters.electricityMeterCountMode,
        ) &&
        countFilterMatches(row.waterMeterCount, filters.waterMeterCountMode) &&
        countFilterMatches(row.meterCount, filters.meterCountMode) &&
        includesText(row.createdByUser, filters.createdByUser) &&
        includesText(formatUpdatedAt(row.updatedAt), filters.updatedAt)
      );
    });
  }, [premiseRows, filters]);

  const sortedPremiseRows = useMemo(() => {
    if (!sortConfig?.key) {
      return [...filteredPremiseRows].sort(sortByUpdatedAtDesc);
    }

    const rows = [...filteredPremiseRows];

    rows.sort((a, b) => {
      const result = compareNatural(
        getSortValue(a, sortConfig.key),
        getSortValue(b, sortConfig.key),
      );

      return sortConfig.direction === "asc" ? result : -result;
    });

    return rows;
  }, [filteredPremiseRows, sortConfig]);

  const totals = premiseRows.reduce(
    (accumulator, row) => {
      accumulator.electricityMeters += row.electricityMeterCount;
      accumulator.waterMeters += row.waterMeterCount;
      accumulator.meters += row.meterCount;

      if (row.occupancyStatus === "Accessed") {
        accumulator.accessed += 1;
      }

      if (row.occupancyStatus === "Occupied") {
        accumulator.occupied += 1;
      }

      return accumulator;
    },
    {
      electricityMeters: 0,
      waterMeters: 0,
      meters: 0,
      accessed: 0,
      occupied: 0,
    },
  );

  function handleWardChange(valueOrEvent) {
    const nextWardPcode = valueOrEvent?.target?.value ?? valueOrEvent;
    const nextWard =
      wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

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

  const visiblePremiseSummary = !effectiveSelectedWardPcode
    ? "No ward selected"
    : sortedPremiseRows.length === premiseRows.length
      ? `Showing ${formatNumber(premiseRows.length)} premise registry row(s)`
      : `Showing ${formatNumber(sortedPremiseRows.length)} of ${formatNumber(premiseRows.length)} premise registry row(s)`;

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>Premise Registry</h1>

          <p className="muted">
            Showing backend-shaped premise registry rows for{" "}
            {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="role-pill">
          {isFetching
            ? "Streaming..."
            : `${formatNumber(sortedPremiseRows.length)} premises`}
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
                Ward {ward.wardNumber}
              </option>
            ))}
          </select>
        </label>

        <div className="filter-summary">
          <strong>{getWardLabel(selectedWard)}</strong>
          <span>{visiblePremiseSummary}</span>
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

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
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
              Check Firestore rules, registry_premises, or the ward field used
              by the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading premise registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading &&
        effectiveSelectedWardPcode &&
        premiseRows.length === 0 &&
        !error ? (
          <div className="empty-state">
            <h2>No premise registry rows found</h2>
            <p className="muted">
              No premises were returned for ward {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {!isLoading &&
        effectiveSelectedWardPcode &&
        premiseRows.length > 0 &&
        sortedPremiseRows.length === 0 &&
        !error ? (
          <div className="empty-state">
            <h2>No rows match the current filters</h2>
            <p className="muted">Adjust the column filters to widen the results.</p>
          </div>
        ) : null}

        {sortedPremiseRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <SortButton
                      label="Premise Address"
                      sortKey="premiseAddress"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.premiseAddress}
                      onChange={(value) => updateFilter("premiseAddress", value)}
                      placeholder="Address or premise ID"
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
                      label="Property Type"
                      sortKey="propertyType"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.propertyType}
                      onChange={(value) => updateFilter("propertyType", value)}
                      placeholder="Type"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Name"
                      sortKey="propertyName"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.propertyName}
                      onChange={(value) => updateFilter("propertyName", value)}
                      placeholder="Name"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Unit"
                      sortKey="unitNo"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.unitNo}
                      onChange={(value) => updateFilter("unitNo", value)}
                      placeholder="Unit"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Occupancy"
                      sortKey="occupancyStatus"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.occupancyStatus}
                      onChange={(value) => updateFilter("occupancyStatus", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="Accessed">Accessed</option>
                      <option value="Occupied">Occupied</option>
                      <option value="NAv">NAv</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Electricity"
                      sortKey="electricityMeterCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.electricityMeterCountMode}
                      onChange={(value) =>
                        updateFilter("electricityMeterCountMode", value)
                      }
                    >
                      <option value="ALL">Any</option>
                      <option value="ZERO">0</option>
                      <option value="ONE">1</option>
                      <option value="MULTIPLE">2+</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Water"
                      sortKey="waterMeterCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.waterMeterCountMode}
                      onChange={(value) => updateFilter("waterMeterCountMode", value)}
                    >
                      <option value="ALL">Any</option>
                      <option value="ZERO">0</option>
                      <option value="ONE">1</option>
                      <option value="MULTIPLE">2+</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Total Meters"
                      sortKey="meterCount"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.meterCountMode}
                      onChange={(value) => updateFilter("meterCountMode", value)}
                    >
                      <option value="ALL">Any</option>
                      <option value="ZERO">0</option>
                      <option value="ONE">1</option>
                      <option value="MULTIPLE">2+</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Created By"
                      sortKey="createdByUser"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.createdByUser}
                      onChange={(value) => updateFilter("createdByUser", value)}
                      placeholder="User"
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
                      placeholder="Date"
                    />
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedPremiseRows.map((row) => (
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
                    <td>{row.createdByUser}</td>
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
