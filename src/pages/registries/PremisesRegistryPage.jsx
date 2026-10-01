/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import { irepsTableDateRange as getUpdatedAtFilterRange } from "../../components/table/irepsTableModel.js";
import IrepsTable from "../../components/table/IrepsTable";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryPremisesByWardQuery } from "../../redux/registryPremisesApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
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

export default function PremisesRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);

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

  const filterRegistryRows = useCallback((rows, tableFilters) => {
    const filters = {
      ...EMPTY_PREMISE_FILTERS,
      ...tableFilters
    };
    for (const key of Object.keys(EMPTY_PREMISE_FILTERS)) {
      if (EMPTY_PREMISE_FILTERS[key] === "ALL" && !filters[key]) filters[key] = "ALL";
    }
    const updatedAtFilter = tableFilters.updatedAt || EMPTY_UPDATED_AT_FILTER;
    return rows.filter(row => {
      return includesText(row.erfNo, filters.erfNo) && includesText(`${row.addressText || ""} ${row.premiseId || ""}`, filters.addressText) && includesText(row.propertyTypeType, filters.propertyTypeType) && includesText(row.propertyTypeName, filters.propertyTypeName) && includesText(row.unitNo, filters.unitNo) && (filters.occupancyStatus === "ALL" || String(row.occupancyStatus || "").toUpperCase() === filters.occupancyStatus) && includesText(getCountText(row.electricityMeterCount), filters.electricityMeterCount) && includesText(getCountText(row.waterMeterCount), filters.waterMeterCount) && includesText(getCountText(row.meterCount), filters.meterCount) && matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter);
    });
  }, []);

  const filteredPremiseRows = useMemo(() => filterRegistryRows(premiseRows, filters), [premiseRows, filters, filterRegistryRows]);

  const totals = filteredPremiseRows.reduce(
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

  function resetTableControls() {
    setFilters(EMPTY_PREMISE_FILTERS);

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

  const registryColumns = [{
    key: "addressText",
    label: "Premise Address",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "addressText"),
    sortValue: row => getSortValue(row, "addressText"),
    render: row => {
      return <><strong>{row.addressText || "NAv"}</strong>
                              <div className="muted" style={styles.smallMuted}>
                                {row.premiseId || "NAv"}
                              </div></>;
    }
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
    key: "propertyTypeType",
    label: "Property Type",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "propertyTypeType"),
    sortValue: row => getSortValue(row, "propertyTypeType"),
    render: row => {
      return <>{row.propertyTypeType}</>;
    }
  }, {
    key: "propertyTypeName",
    label: "Name",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "propertyTypeName"),
    sortValue: row => getSortValue(row, "propertyTypeName"),
    render: row => {
      return <>{row.propertyTypeName}</>;
    }
  }, {
    key: "unitNo",
    label: "Unit",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "unitNo"),
    sortValue: row => getSortValue(row, "unitNo"),
    render: row => {
      return <>{row.unitNo}</>;
    }
  }, {
    key: "occupancyStatus",
    label: "Occupancy",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "occupancyStatus"),
    sortValue: row => getSortValue(row, "occupancyStatus"),
    render: row => {
      return <>{row.occupancyStatus}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "ACCESSED",
      label: "Accessed"
    }, {
      value: "OCCUPIED",
      label: "Occupied"
    }, {
      value: "VACANT",
      label: "Vacant"
    }, {
      value: "NAV",
      label: "NAv"
    }]
  }, {
    key: "electricityMeterCount",
    label: "Electricity",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "electricityMeterCount"),
    sortValue: row => getSortValue(row, "electricityMeterCount"),
    render: row => {
      return <>{formatNumber(row.electricityMeterCount)}</>;
    }
  }, {
    key: "waterMeterCount",
    label: "Water",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "waterMeterCount"),
    sortValue: row => getSortValue(row, "waterMeterCount"),
    render: row => {
      return <>{formatNumber(row.waterMeterCount)}</>;
    }
  }, {
    key: "meterCount",
    label: "Total Meters",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "meterCount"),
    sortValue: row => getSortValue(row, "meterCount"),
    render: row => {
      return <>{formatNumber(row.meterCount)}</>;
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
            {isFetching ? "Streaming..." : `${formatNumber(filteredPremiseRows.length)} premises`}
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
          <strong>{formatNumber(filteredPremiseRows.length)}</strong>
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

            <div className="table-wrap">
              <IrepsTable
                key={`${activeLmPcode}:${effectiveSelectedWardPcode}`}
                title="Premises Registry"
                rows={premiseRows}
                columns={registryColumns}
                rowKey={row => row.id}
                filters={filters}
                onFiltersChange={setFilters}
                filteredRows={filteredPremiseRows}
                filterRows={filterRegistryRows}
                defaultSort={DEFAULT_SORT}
                downloads={{
                  registryName: "Premise Registry",
                  rowsLabel: "premises",
                  columns: quickDownloadColumns,
                  fileBaseName: "premises_registry",
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
    paddingBottom: "0.85rem",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
  },

  smallMuted: {
    fontSize: "0.72rem",
    marginTop: "0.25rem",
  },
};
