import { useMemo, useState } from "react";

import WardScopeHeader from "./components/WardScopeHeader";
import { useWarehouse } from "../../context/WarehouseContext";

const EMPTY_COLUMN_FILTERS = {
  meterNo: "",
  type: "",
  kind: "",
  phase: "",
  address: "",
  erfNo: "",
  gps: "",
  geofence: "",
  updated: "",
  updatedBy: "",
  meterId: "",
};


const COLUMN_HEADER_FILTER_WRAP_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const COLUMN_HEADER_LABEL_STYLE = {
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const COLUMN_FILTER_INPUT_STYLE = {
  width: "100%",
  minWidth: 86,
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#fff",
  color: "#0f172a",
  fontSize: 11,
  padding: "6px 8px",
};

const CLEAR_FILTERS_BUTTON_STYLE = {
  border: "1px solid #fbbf24",
  borderRadius: 999,
  background: "#fffbeb",
  color: "#92400e",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 800,
  padding: "8px 12px",
};

const LOADING_STATE_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const SPINNER_STYLE = {
  width: 16,
  height: 16,
  border: "3px solid #e2e8f0",
  borderTopColor: "#2563eb",
  borderRadius: "50%",
  animation: "irepsWardScopeSpin 0.8s linear infinite",
};

function normalizeFilterText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function matchesTextFilter(value, filterValue) {
  const needle = normalizeFilterText(filterValue);

  if (!needle) return true;

  return normalizeFilterText(value).includes(needle);
}

function hasActiveColumnFilters(columnFilters) {
  return Object.values(columnFilters).some((value) => normalizeFilterText(value));
}

function ColumnHeaderFilter({ label, field, value, onChange, placeholder }) {
  return (
    <div style={COLUMN_HEADER_FILTER_WRAP_STYLE}>
      <span style={COLUMN_HEADER_LABEL_STYLE}>{label}</span>
      <input
        aria-label={`Filter ${label}`}
        placeholder={placeholder || "Filter"}
        style={COLUMN_FILTER_INPUT_STYLE}
        type="text"
        value={value || ""}
        onChange={(event) => onChange(field, event.target.value)}
      />
    </div>
  );
}

function LoadingRowsState({ label }) {
  return (
    <div className="empty-state">
      <style>{`@keyframes irepsWardScopeSpin { to { transform: rotate(360deg); } }`}</style>
      <div style={LOADING_STATE_STYLE}>
        <span aria-hidden="true" style={SPINNER_STYLE} />
        <div>
          <h2>{label}</h2>
          <p className="muted">Waiting for the Ward Warehouse stream.</p>
        </div>
      </div>
    </div>
  );
}

const getMeterKey = (meter) =>
  meter?.ast?.astData?.astId ||
  meter?.astData?.astId ||
  meter?.meterId ||
  meter?.id ||
  meter?.meterNo ||
  "NAv";

const getMeterNo = (meter) =>
  meter?.ast?.astData?.astNo ||
  meter?.astData?.astNo ||
  meter?.meterNo ||
  "NAv";

const getMeterType = (meter) =>
  meter?.meterType ||
  meter?.accessData?.meterType ||
  meter?.ast?.astData?.astType ||
  meter?.astData?.astType ||
  "NAv";

const getMeterKind = (meter) =>
  meter?.ast?.astData?.meter?.type ||
  meter?.astData?.meter?.type ||
  meter?.meterKind ||
  "NAv";

const getMeterPhase = (meter) =>
  meter?.ast?.astData?.meter?.phase ||
  meter?.astData?.meter?.phase ||
  meter?.meterPhase ||
  "NAv";

const getPremiseId = (meter) =>
  meter?.accessData?.premise?.id ||
  meter?.premiseId ||
  meter?.premise?.id ||
  "NAv";

const getPremiseAddress = (meter) =>
  meter?.accessData?.premise?.address || meter?.premiseAddress || "NAv";

const getErfNo = (meter) => meter?.accessData?.erfNo || meter?.erfNo || "NAv";

const getErfId = (meter) => meter?.accessData?.erfId || meter?.erfId || "NAv";

const getWardPcode = (meter) =>
  meter?.accessData?.parents?.wardPcode ||
  meter?.parents?.wardPcode ||
  meter?.wardPcode ||
  "NAv";

const getLmPcode = (meter) =>
  meter?.accessData?.parents?.lmPcode ||
  meter?.parents?.lmPcode ||
  meter?.lmPcode ||
  "NAv";

const getUpdatedAt = (meter) =>
  meter?.metadata?.updatedAt || meter?.accessData?.metadata?.updatedAt || "NAv";

const getUpdatedBy = (meter) =>
  meter?.metadata?.updatedByUser ||
  meter?.accessData?.metadata?.updatedByUser ||
  meter?.metadata?.updatedBy ||
  "NAv";

const getGpsLabel = (meter) => {
  const gps =
    meter?.ast?.location?.gps || meter?.location?.gps || meter?.gps || null;

  const lat = gps?.lat || gps?.latitude || null;
  const lng = gps?.lng || gps?.longitude || null;

  if (!lat || !lng) return "NAv";

  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
};

const getGeofenceNames = (meter) => {
  const refs = Array.isArray(meter?.geofenceRefs)
    ? meter.geofenceRefs
    : Array.isArray(meter?.ast?.geofenceRefs)
      ? meter.ast.geofenceRefs
      : [];

  if (!refs.length) return "NAv";

  return refs
    .map((ref) => ref?.name || ref?.id)
    .filter(Boolean)
    .join(", ");
};

function applyColumnFilters(meters, columnFilters) {
  return meters.filter((meter) => {
    return (
      matchesTextFilter(getMeterNo(meter), columnFilters.meterNo) &&
      matchesTextFilter(getMeterType(meter), columnFilters.type) &&
      matchesTextFilter(getMeterKind(meter), columnFilters.kind) &&
      matchesTextFilter(getMeterPhase(meter), columnFilters.phase) &&
      matchesTextFilter(getPremiseAddress(meter), columnFilters.address) &&
      matchesTextFilter(getErfNo(meter), columnFilters.erfNo) &&
      matchesTextFilter(getGpsLabel(meter), columnFilters.gps) &&
      matchesTextFilter(getGeofenceNames(meter), columnFilters.geofence) &&
      matchesTextFilter(getUpdatedAt(meter), columnFilters.updated) &&
      matchesTextFilter(getUpdatedBy(meter), columnFilters.updatedBy) &&
      matchesTextFilter(getMeterKey(meter), columnFilters.meterId)
    );
  });
}

export default function MetersPage() {
  const { all, filtered, sync, loading } = useWarehouse();
  const [columnFilters, setColumnFilters] = useState(EMPTY_COLUMN_FILTERS);

  const allMeters = all?.meters || [];
  const meters = filtered?.meters || [];
  const metersSync = sync?.meters || {};
  const selectedWardPcode = sync?.scope?.wardPcode || metersSync?.wardPcode || "";
  const hasColumnFilters = hasActiveColumnFilters(columnFilters);
  const visibleMeters = useMemo(
    () => applyColumnFilters(meters, columnFilters),
    [meters, columnFilters],
  );
  const isWaitingForMeters =
    Boolean(selectedWardPcode) &&
    meters.length === 0 &&
    (loading ||
      metersSync?.status === "pending" ||
      metersSync?.status === "loading" ||
      metersSync?.status === "syncing");

  function updateColumnFilter(field, value) {
    setColumnFilters((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function clearColumnFilters() {
    setColumnFilters(EMPTY_COLUMN_FILTERS);
  }

  return (
    <>
      <WardScopeHeader
        showGeofenceLens
        geofenceClearLabel="Clear meters"
        stats={[
          {
            label: "Ward Meters",
            value: loading
              ? "Loading..."
              : metersSync?.status === "ready" ||
                  metersSync?.status === "pending"
                ? allMeters.length
                : metersSync?.status || "idle",
          },
          {
            label: "Visible Meters",
            value: visibleMeters.length,
          },
          {
            label: "Visible Premises",
            value: filtered?.prems?.length || 0,
          },
        ]}
      />

      <section className="table-panel">
        <div className="load-more-row">
          <div>
            <strong>Operational Meters</strong>
            <p className="muted">
              Meters are loaded through the Ward Warehouse from the operational
              ASTs collection. The geofence dropdown filters meters and premises
              through GeoContext.
            </p>
          </div>

          <div className="filter-summary">
            <strong>{metersSync?.status || "idle"}</strong>
            <span>{visibleMeters.length} visible rows</span>
            {hasColumnFilters ? (
              <button
                type="button"
                style={CLEAR_FILTERS_BUTTON_STYLE}
                onClick={clearColumnFilters}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        {!selectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Choose a ward above to load operational meters from the warehouse.
            </p>
          </div>
        ) : isWaitingForMeters ? (
          <LoadingRowsState label="Loading meters" />
        ) : meters.length === 0 ? (
          <div className="empty-state">
            <h2>No meters loaded</h2>
            <p className="muted">
              Meter sync status: {metersSync?.status || "idle"}. If a geofence
              is selected, it may have no linked meters.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <ColumnHeaderFilter
                      field="meterNo"
                      label="Meter No"
                      value={columnFilters.meterNo}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="type"
                      label="Type"
                      value={columnFilters.type}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="kind"
                      label="Kind"
                      value={columnFilters.kind}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="phase"
                      label="Phase"
                      value={columnFilters.phase}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="address"
                      label="Address"
                      value={columnFilters.address}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="erfNo"
                      label="ERF No"
                      value={columnFilters.erfNo}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="gps"
                      label="GPS"
                      value={columnFilters.gps}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="geofence"
                      label="Geofence"
                      value={columnFilters.geofence}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="updated"
                      label="Updated"
                      value={columnFilters.updated}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="updatedBy"
                      label="Updated By"
                      value={columnFilters.updatedBy}
                      onChange={updateColumnFilter}
                    />
                  </th>
                  <th>
                    <ColumnHeaderFilter
                      field="meterId"
                      label="Meter ID"
                      value={columnFilters.meterId}
                      onChange={updateColumnFilter}
                    />
                  </th>
                </tr>
              </thead>

              <tbody>
                {visibleMeters.length === 0 ? (
                  <tr>
                    <td colSpan={11}>No meters match the column filters.</td>
                  </tr>
                ) : (
                  visibleMeters.map((meter) => (
                    <tr key={getMeterKey(meter)}>
                      <td>{getMeterNo(meter)}</td>
                      <td>{getMeterType(meter)}</td>
                      <td>{getMeterKind(meter)}</td>
                      <td>{getMeterPhase(meter)}</td>
                      <td>{getPremiseAddress(meter)}</td>
                      <td title={getErfId(meter)}>{getErfNo(meter)}</td>
                      <td>{getGpsLabel(meter)}</td>
                      <td>{getGeofenceNames(meter)}</td>
                      <td>{getUpdatedAt(meter)}</td>
                      <td>{getUpdatedBy(meter)}</td>
                      <td>{getMeterKey(meter)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
