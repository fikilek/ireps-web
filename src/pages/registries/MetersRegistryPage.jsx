/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import { irepsTableDateRange as getUpdatedAtFilterRange } from "../../components/table/irepsTableModel.js";
import IrepsTable from "../../components/table/IrepsTable";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryMetersByWardQuery } from "../../redux/registryMetersApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
const EMPTY_METER_FILTERS = {
  meterNo: "",
  meterType: "ALL",
  meterKind: "ALL",
  meterPhase: "ALL",
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
  if (["Pending", "Unavailable", "Incomplete"].includes(value)) return value;
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

function getRegistryLabel(value) {
  const text = String(value || "")
    .trim()
    .replace(/[_-]+/g, " ");

  if (!text || text === "NAv") return "NAv";

  return text
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getMeterKindLabel(meterKind) {
  return getRegistryLabel(meterKind);
}

function getMeterPhaseLabel(meterPhase) {
  return getRegistryLabel(meterPhase);
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

  return (
    selectedWard?.id || selectedWard?.pcode || selectedWard?.wardPcode || ""
  );
}

function buildRegistryWardSelection(ward, fallbackWardPcode = "") {
  const wardPcode =
    ward?.wardPcode || ward?.pcode || ward?.id || fallbackWardPcode || "";

  if (!wardPcode) return null;

  const wardNumber =
    ward?.wardNumber ||
    ward?.code ||
    getWardNumberFromPcode(wardPcode) ||
    "NAv";

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

function buildFilterOptions(rows, key) {
  return Array.from(
    new Set(
      rows
        .map((row) => row?.[key])
        .filter((value) => value && value !== "NAv"),
    ),
  ).sort(compareNatural);
}

function getSortValue(row, key) {
  if (key === "meterNo") return row.meterNo || "";
  if (key === "meterType") return getMeterTypeLabel(row.meterType);
  if (key === "meterKind") return getMeterKindLabel(row.meterKind);
  if (key === "meterPhase") return getMeterPhaseLabel(row.meterPhase);
  if (key === "visibility") return row.visibility || "";
  if (key === "status") return row.statusState || row.status || "";
  if (key === "erfNo") return row.erfNo || "";
  if (key === "premiseAddress") return row.premiseAddress || "";
  if (key === "premiseType") return row.premisePropertyType || "";
  if (key === "updatedAt") return getUpdatedAtMs(row.updatedAt);

  return "";
}

const EMPTY_UPDATED_AT_FILTER = {
  mode: "ALL",
  startDate: "",
  endDate: "",
};

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

  const [filters, setFilters] = useState(EMPTY_METER_FILTERS);

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

  const {
    data: meterRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryMetersByWardQuery(effectiveSelectedWardPcode || skipToken);
  const meterKindOptions = useMemo(
    () => buildFilterOptions(meterRows, "meterKind"),
    [meterRows],
  );

  const meterPhaseOptions = useMemo(
    () => buildFilterOptions(meterRows, "meterPhase"),
    [meterRows],
  );

  const filterRegistryRows = useCallback((rows, tableFilters) => {
    const filters = {
      ...EMPTY_METER_FILTERS,
      ...tableFilters
    };
    for (const key of Object.keys(EMPTY_METER_FILTERS)) {
      if (EMPTY_METER_FILTERS[key] === "ALL" && !filters[key]) filters[key] = "ALL";
    }
    const updatedAtFilter = tableFilters.updatedAt || EMPTY_UPDATED_AT_FILTER;
    return rows.filter(row => {
      const statusText = row.statusState || row.status || "NAv";
      return includesText(row.meterNo, filters.meterNo) && (filters.meterType === "ALL" || String(row.meterType || "").toLowerCase() === filters.meterType.toLowerCase()) && (filters.meterKind === "ALL" || String(row.meterKind || "").toLowerCase() === filters.meterKind.toLowerCase()) && (filters.meterPhase === "ALL" || String(row.meterPhase || "").toLowerCase() === filters.meterPhase.toLowerCase()) && (filters.visibility === "ALL" || String(row.visibility || "").toUpperCase() === filters.visibility) && (filters.status === "ALL" || String(statusText || "").toUpperCase() === filters.status) && includesText(row.erfNo, filters.erfNo) && includesText(`${row.premiseAddress || ""} ${row.premiseId || ""}`, filters.premiseAddress) && includesText(row.premisePropertyType, filters.premiseType) && matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter);
    });
  }, []);

  const filteredMeterRows = useMemo(() => filterRegistryRows(meterRows, filters), [meterRows, filters, filterRegistryRows]);

  const totals = filteredMeterRows.reduce(
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
        header: "Kind",
        value: (row) => getMeterKindLabel(row.meterKind),
      },
      {
        header: "Phase",
        value: (row) => getMeterPhaseLabel(row.meterPhase),
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
    [
      activeWorkbaseName,
      activeLmPcode,
      selectedWard,
      effectiveSelectedWardPcode,
    ],
  );

  function resetMeterRegistryControls() {
    setFilters(EMPTY_METER_FILTERS);

  }

  function handleWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard =
      wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    resetMeterRegistryControls();

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

  const registryColumns = [{
    key: "meterNo",
    label: "Meter No",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "meterNo"),
    sortValue: row => getSortValue(row, "meterNo"),
    render: row => {
      return <>{row.meterNo}</>;
    }
  }, {
    key: "meterType",
    label: "Type",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "meterType"),
    sortValue: row => getSortValue(row, "meterType"),
    render: row => {
      return <>{getMeterTypeLabel(row.meterType)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "electricity",
      label: "Electricity"
    }, {
      value: "water",
      label: "Water"
    }]
  }, {
    key: "meterKind",
    label: "Kind",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "meterKind"),
    sortValue: row => getSortValue(row, "meterKind"),
    render: row => {
      return <>{getMeterKindLabel(row.meterKind)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [...meterKindOptions.map(meterKind => ({
      value: meterKind,
      label: getMeterKindLabel(meterKind)
    }))]
  }, {
    key: "meterPhase",
    label: "Phase",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "meterPhase"),
    sortValue: row => getSortValue(row, "meterPhase"),
    render: row => {
      return <>{getMeterPhaseLabel(row.meterPhase)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [...meterPhaseOptions.map(meterPhase => ({
      value: meterPhase,
      label: getMeterPhaseLabel(meterPhase)
    }))]
  }, {
    key: "visibility",
    label: "Visibility",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "visibility"),
    sortValue: row => getSortValue(row, "visibility"),
    render: row => {
      return <>{row.visibility}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "VISIBLE",
      label: "Visible"
    }, {
      value: "INVISIBLE",
      label: "Invisible"
    }]
  }, {
    key: "status",
    label: "Status",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "status"),
    sortValue: row => getSortValue(row, "status"),
    render: row => {
      return <>{row.statusState || row.status || "NAv"}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "FIELD",
      label: "FIELD"
    }, {
      value: "CONNECTED",
      label: "CONNECTED"
    }, {
      value: "DISCONNECTED",
      label: "DISCONNECTED"
    }, {
      value: "REMOVED",
      label: "REMOVED"
    }, {
      value: "DECOMMISSIONED",
      label: "DECOMMISSIONED"
    }]
  }, {
    key: "erfNo",
    label: "ERF No",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "erfNo"),
    sortValue: row => getSortValue(row, "erfNo"),
    render: row => {
      return <>{row.erfNo}</>;
    }
  }, {
    key: "premiseAddress",
    label: "Premise Address",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "premiseAddress"),
    sortValue: row => getSortValue(row, "premiseAddress"),
    render: row => {
      return <><strong>{row.premiseAddress || "NAv"}</strong>
                                <div className="muted" style={styles.smallMuted}>
                                  {row.premiseId || "NAv"}
                                </div></>;
    }
  }, {
    key: "premiseType",
    label: "Premise Type",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "premiseType"),
    sortValue: row => getSortValue(row, "premiseType"),
    render: row => {
      return <>{row.premisePropertyType}</>;
    }
  }, {
    key: "updatedAt",
    label: "updatedAt",
    filter: "date",
    sortable: true,
    value: row => getSortValue(row, "updatedAt"),
    sortValue: row => getSortValue(row, "updatedAt"),
    render: row => {
      return <>{formatUpdatedAt(row.updatedAt)}</>;
    }
  }];

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
            {isFetching
              ? "Streaming..."
              : `${formatNumber(filteredMeterRows.length)} meters`}
          </div>

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
          <strong>{formatNumber(filteredMeterRows.length)}</strong>
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

        {meterRows.length > 0 ? (
          <>

            <div className="table-wrap">
              <IrepsTable
                key={`${activeLmPcode}:${effectiveSelectedWardPcode}`}
                title="Meters Registry"
                rows={meterRows}
                columns={registryColumns}
                rowKey={row => row.id}
                filters={filters}
                onFiltersChange={setFilters}
                filteredRows={filteredMeterRows}
                filterRows={filterRegistryRows}
                defaultSort={{
                  key: "updatedAt",
                  direction: "desc"
                }}
                downloads={{
                  registryName: "Meter Registry",
                  rowsLabel: "meters",
                  columns: quickDownloadColumns,
                  fileBaseName: "meters_registry",
                  scope: quickDownloadScope
                }}
              />
            </div>

          </>
        ) : null}
      </section>

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

  smallMuted: {
    fontSize: "0.72rem",
    marginTop: "0.25rem",
  },

};
