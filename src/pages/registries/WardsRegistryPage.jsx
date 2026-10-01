/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import { irepsTableDateRange as getUpdatedAtFilterRange } from "../../components/table/irepsTableModel.js";
import IrepsTable from "../../components/table/IrepsTable";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
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

export default function WardsRegistryPage() {
  const { activeWorkbase, role } = useAuth();

  const [filters, setFilters] = useState(EMPTY_WARD_FILTERS);

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

  const filterRegistryRows = useCallback((rows, tableFilters) => {
    const filters = {
      ...EMPTY_WARD_FILTERS,
      ...tableFilters
    };
    for (const key of Object.keys(EMPTY_WARD_FILTERS)) {
      if (EMPTY_WARD_FILTERS[key] === "ALL" && !filters[key]) filters[key] = "ALL";
    }
    const updatedAtFilter = tableFilters.updatedAt || EMPTY_UPDATED_AT_FILTER;
    return rows.filter(row => {
      return includesText(row.wardNumber, filters.wardNumber) && includesText(getCountText(row.formalErfCount), filters.formalErfCount) && includesText(getCountText(row.informalErfCount), filters.informalErfCount) && includesText(getCountText(row.totalErfCount), filters.totalErfCount) && includesText(getCountText(row.premiseCount), filters.premiseCount) && includesText(getCountText(row.electricityMeterCount), filters.electricityMeterCount) && includesText(getCountText(row.waterMeterCount), filters.waterMeterCount) && includesText(getCountText(row.meterCount), filters.meterCount) && includesText(getCountText(row.trnCount), filters.trnCount) && matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter);
    });
  }, []);

  const filteredWardRows = useMemo(() => filterRegistryRows(wardRows, filters), [wardRows, filters, filterRegistryRows]);

  const totals = filteredWardRows.reduce(
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

  const registryColumns = [{
    key: "wardNumber",
    label: "Ward",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "wardNumber"),
    sortValue: row => getSortValue(row, "wardNumber"),
    render: row => {
      return <>{row.wardNumber}</>;
    }
  }, {
    key: "formalErfCount",
    label: "Formal ERFs",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "formalErfCount"),
    sortValue: row => getSortValue(row, "formalErfCount"),
    render: row => {
      return <>{formatNumber(row.formalErfCount)}</>;
    }
  }, {
    key: "informalErfCount",
    label: "Informal ERFs",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "informalErfCount"),
    sortValue: row => getSortValue(row, "informalErfCount"),
    render: row => {
      return <>{formatNumber(row.informalErfCount)}</>;
    }
  }, {
    key: "totalErfCount",
    label: "Total ERFs",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "totalErfCount"),
    sortValue: row => getSortValue(row, "totalErfCount"),
    render: row => {
      return <>{formatNumber(row.totalErfCount)}</>;
    }
  }, {
    key: "premiseCount",
    label: "Premises",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "premiseCount"),
    sortValue: row => getSortValue(row, "premiseCount"),
    render: row => {
      return <>{formatNumber(row.premiseCount)}</>;
    }
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
    key: "trnCount",
    label: "TRNs",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "trnCount"),
    sortValue: row => getSortValue(row, "trnCount"),
    render: row => {
      return <>{formatNumber(row.trnCount)}</>;
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
            {isFetching
              ? "Streaming..."
              : `${formatNumber(filteredWardRows.length)} wards`}
          </div>

        </div>
      </header>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Wards</span>
          <strong>{formatNumber(wardRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(filteredWardRows.length)}</strong>
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

        {wardRows.length > 0 ? (
          <>

            <div className="table-wrap">
              <IrepsTable
                key={activeLmPcode}
                title="Wards Registry"
                rows={wardRows}
                columns={registryColumns}
                rowKey={row => row.id}
                filters={filters}
                onFiltersChange={setFilters}
                filteredRows={filteredWardRows}
                filterRows={filterRegistryRows}
                defaultSort={{
                  key: "updatedAt",
                  direction: "desc"
                }}
                downloads={{
                  registryName: "Ward Registry",
                  rowsLabel: "wards",
                  columns: quickDownloadColumns,
                  fileBaseName: "wards_registry",
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

};
