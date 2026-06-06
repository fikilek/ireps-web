import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryMetersByWardQuery } from "../../redux/registryMetersApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

const EMPTY_METER_FILTERS = {
  meterNo: "",
  meterType: "ALL",
  statusState: "ALL",
  visibility: "ALL",
  erfNo: "",
  premiseAddress: "",
  premisePropertyType: "",
  premiseId: "",
  createdByUser: "",
  updatedAt: "",
};

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

function getMeterStatusLabel(statusState) {
  const normalizedStatus = String(statusState || "NAv").toUpperCase();

  if (normalizedStatus === "REMOVED") return "REMOVED";
  if (normalizedStatus === "CONNECTED") return "CONNECTED";
  if (normalizedStatus === "DISCONNECTED") return "DISCONNECTED";
  if (normalizedStatus === "FIELD") return "FIELD";

  return normalizedStatus || "NAv";
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function rowMatchesText(rowValue, filterValue) {
  const filterText = normalizeText(filterValue);

  if (!filterText) return true;

  return normalizeText(rowValue).includes(filterText);
}

function rowMatchesSelect(rowValue, filterValue) {
  if (!filterValue || filterValue === "ALL") return true;

  return String(rowValue || "NAv").toUpperCase() === String(filterValue).toUpperCase();
}

function sortByUpdatedAtDesc(a, b) {
  const updatedCompare = getUpdatedAtMs(b.updatedAt) - getUpdatedAtMs(a.updatedAt);

  if (updatedCompare !== 0) return updatedCompare;

  return String(a.meterNo || "").localeCompare(String(b.meterNo || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function buildUniqueOptions(rows = [], field) {
  return Array.from(
    new Set(
      rows
        .map((row) => String(row?.[field] || "NAv").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}


function HeaderLabel({ children }) {
  return <span style={styles.headerLabel}>{children}</span>;
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

function applyMeterFilters(rows = [], filters = EMPTY_METER_FILTERS) {
  return rows.filter((row) => {
    return (
      rowMatchesText(row.meterNo, filters.meterNo) &&
      rowMatchesSelect(row.meterType, filters.meterType) &&
      rowMatchesSelect(row.statusState, filters.statusState) &&
      rowMatchesSelect(row.visibility, filters.visibility) &&
      rowMatchesText(row.erfNo, filters.erfNo) &&
      rowMatchesText(row.premiseAddress, filters.premiseAddress) &&
      rowMatchesText(row.premisePropertyType, filters.premisePropertyType) &&
      rowMatchesText(row.premiseId, filters.premiseId) &&
      rowMatchesText(row.createdByUser, filters.createdByUser) &&
      rowMatchesText(formatUpdatedAt(row.updatedAt), filters.updatedAt)
    );
  });
}


const styles = {
  headerLabel: {
    display: "block",
    width: "100%",
    marginBottom: "0.4rem",
    fontWeight: 900,
    lineHeight: 1.15,
    whiteSpace: "normal",
  },
  headerInput: {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    minWidth: "8rem",
    marginTop: 0,
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
  },
  headerSelect: {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    minWidth: "7.5rem",
    marginTop: 0,
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
  },
};

export default function MetersRegistryPage() {
  const { activeWorkbase } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);
  const previousWardPcodeRef = useRef(selectedWardPcode);
  const [meterFilters, setMeterFilters] = useState(EMPTY_METER_FILTERS);

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
    setMeterFilters(EMPTY_METER_FILTERS);
  }, [effectiveSelectedWardPcode]);

  const {
    data: meterRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryMetersByWardQuery(effectiveSelectedWardPcode || skipToken);

  const filteredMeterRows = useMemo(() => {
    return applyMeterFilters(meterRows, meterFilters);
  }, [meterRows, meterFilters]);

  const sortedMeterRows = useMemo(() => {
    return [...filteredMeterRows].sort(sortByUpdatedAtDesc);
  }, [filteredMeterRows]);

  const meterTypeOptions = useMemo(() => {
    return buildUniqueOptions(meterRows, "meterType");
  }, [meterRows]);

  const statusOptions = useMemo(() => {
    return buildUniqueOptions(meterRows, "statusState");
  }, [meterRows]);

  const visibilityOptions = useMemo(() => {
    return buildUniqueOptions(meterRows, "visibility");
  }, [meterRows]);

  const hasActiveFilters = useMemo(() => {
    return Object.entries(meterFilters).some(([key, value]) => {
      const defaultValue = EMPTY_METER_FILTERS[key];
      return value !== defaultValue;
    });
  }, [meterFilters]);

  const totals = meterRows.reduce(
    (accumulator, row) => {
      if (row.meterType === "electricity") {
        accumulator.electricity += 1;
      }

      if (row.meterType === "water") {
        accumulator.water += 1;
      }

      if (row.visibility === "VISIBLE") {
        accumulator.visible += 1;
      }

      if (row.visibility === "INVISIBLE") {
        accumulator.invisible += 1;
      }

      if (String(row.statusState || "").toUpperCase() === "REMOVED") {
        accumulator.removed += 1;
      }

      return accumulator;
    },
    {
      electricity: 0,
      water: 0,
      visible: 0,
      invisible: 0,
      removed: 0,
    },
  );

  function handleWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard =
      wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

  function handleFilterChange(field, value) {
    setMeterFilters((currentFilters) => ({
      ...currentFilters,
      [field]: value,
    }));
  }

  function handleClearFilters() {
    setMeterFilters(EMPTY_METER_FILTERS);
  }

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>Meter Registry</h1>

          <p className="muted">
            Showing backend-shaped meter registry rows for {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="role-pill">
          {isFetching
            ? "Streaming..."
            : hasActiveFilters
              ? `${formatNumber(sortedMeterRows.length)} of ${formatNumber(meterRows.length)} meters`
              : `${formatNumber(meterRows.length)} meters`}
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
          <span>Removed</span>
          <strong>{formatNumber(totals.removed)}</strong>
        </div>

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
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
              Check Firestore rules, registry_meters, or the ward field used by
              the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading meter registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading &&
        effectiveSelectedWardPcode &&
        meterRows.length === 0 &&
        !error ? (
          <div className="empty-state">
            <h2>No meter registry rows found</h2>
            <p className="muted">
              No meters were returned for ward {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {!isLoading && meterRows.length > 0 && sortedMeterRows.length === 0 ? (
          <div className="empty-state">
            <h2>No rows match the current filters</h2>
            <p className="muted">
              Clear one or more column filters to show meter registry rows again.
            </p>
            <button type="button" className="secondary-button" onClick={handleClearFilters}>
              Clear Filters
            </button>
          </div>
        ) : null}

        {sortedMeterRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <HeaderLabel>Meter No</HeaderLabel>
                    <FilterInput
                      value={meterFilters.meterNo}
                      onChange={(value) => handleFilterChange("meterNo", value)}
                      placeholder="Filter"
                    />
                  </th>

                  <th>
                    <HeaderLabel>Type</HeaderLabel>
                    <FilterSelect
                      value={meterFilters.meterType}
                      onChange={(value) => handleFilterChange("meterType", value)}
                    >
                      <option value="ALL">Any</option>
                      {meterTypeOptions.map((meterType) => (
                        <option key={meterType} value={meterType}>
                          {getMeterTypeLabel(meterType)}
                        </option>
                      ))}
                    </FilterSelect>
                  </th>

                  <th>
                    <HeaderLabel>Status</HeaderLabel>
                    <FilterSelect
                      value={meterFilters.statusState}
                      onChange={(value) => handleFilterChange("statusState", value)}
                    >
                      <option value="ALL">Any</option>
                      {statusOptions.map((statusState) => (
                        <option key={statusState} value={statusState}>
                          {getMeterStatusLabel(statusState)}
                        </option>
                      ))}
                    </FilterSelect>
                  </th>

                  <th>
                    <HeaderLabel>Visibility</HeaderLabel>
                    <FilterSelect
                      value={meterFilters.visibility}
                      onChange={(value) => handleFilterChange("visibility", value)}
                    >
                      <option value="ALL">Any</option>
                      {visibilityOptions.map((visibility) => (
                        <option key={visibility} value={visibility}>
                          {visibility}
                        </option>
                      ))}
                    </FilterSelect>
                  </th>

                  <th>
                    <HeaderLabel>ERF No</HeaderLabel>
                    <FilterInput
                      value={meterFilters.erfNo}
                      onChange={(value) => handleFilterChange("erfNo", value)}
                      placeholder="Filter"
                    />
                  </th>

                  <th>
                    <HeaderLabel>Premise Address</HeaderLabel>
                    <FilterInput
                      value={meterFilters.premiseAddress}
                      onChange={(value) => handleFilterChange("premiseAddress", value)}
                      placeholder="Filter"
                    />
                  </th>

                  <th>
                    <HeaderLabel>Premise Type</HeaderLabel>
                    <FilterInput
                      value={meterFilters.premisePropertyType}
                      onChange={(value) => handleFilterChange("premisePropertyType", value)}
                      placeholder="Filter"
                    />
                  </th>

                  <th>
                    <HeaderLabel>Premise ID</HeaderLabel>
                    <FilterInput
                      value={meterFilters.premiseId}
                      onChange={(value) => handleFilterChange("premiseId", value)}
                      placeholder="Filter"
                    />
                  </th>

                  <th>
                    <HeaderLabel>Created By</HeaderLabel>
                    <FilterInput
                      value={meterFilters.createdByUser}
                      onChange={(value) => handleFilterChange("createdByUser", value)}
                      placeholder="Filter"
                    />
                  </th>

                  <th>
                    <HeaderLabel>Updated</HeaderLabel>
                    <FilterInput
                      value={meterFilters.updatedAt}
                      onChange={(value) => handleFilterChange("updatedAt", value)}
                      placeholder="YYYY-MM-DD"
                    />
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedMeterRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.meterNo}</td>
                    <td>{getMeterTypeLabel(row.meterType)}</td>
                    <td>{getMeterStatusLabel(row.statusState)}</td>
                    <td>{row.visibility}</td>
                    <td>{row.erfNo}</td>
                    <td>{row.premiseAddress}</td>
                    <td>{row.premisePropertyType}</td>
                    <td>{row.premiseId}</td>
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
